import AppKit
@preconcurrency import CoreLocation

struct LocationFailure: Codable, Error {
    let code: String
    let message: String
    var domain: String? = nil
    var nativeCode: Int? = nil
    var diagnostics: LocationRequestDiagnostics? = nil
}
// Failure-only, bounded metadata. No authorization decisions, location samples,
// wall-clock timestamps, app/window names or native error text are recorded.
struct LocationRequestDiagnostics: Codable {
    enum Stage: String, Codable {
        case validatingArguments, waitingForAuthorizationCallback, authorizationCallbackReceived
        case waitingForActivation, authorizationRequested
    }
    var firstAuthorizationCallbackMs: Int?
    var activationRequested = false
    var didBecomeActiveReceived = false
    var lastStage: Stage = .validatingArguments
    let isActive: Bool
}
// The live delegate supplies events; tests supply events and a monotonic clock.
// This recorder observes the existing flow and never drives or retries it.
struct LocationRequestTrace {
    enum Event {
        case waitingForAuthorizationCallback, authorizationCallback, activationRequested
        case didBecomeActive, authorizationRequested
    }
    private let started: TimeInterval
    private let now: () -> TimeInterval
    private var firstAuthorizationCallbackMs: Int?
    private var activationRequested = false
    private var didBecomeActiveReceived = false
    private var lastStage: LocationRequestDiagnostics.Stage = .validatingArguments

    init(started: TimeInterval, now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.started = started; self.now = now
    }
    mutating func record(_ event: Event) {
        switch event {
        case .waitingForAuthorizationCallback: lastStage = .waitingForAuthorizationCallback
        case .authorizationCallback:
            if firstAuthorizationCallbackMs == nil {
                firstAuthorizationCallbackMs = max(0, Int((now() - started) * 1000))
                lastStage = .authorizationCallbackReceived
            }
        case .activationRequested:
            activationRequested = true; lastStage = .waitingForActivation
        case .didBecomeActive:
            didBecomeActiveReceived = true
        case .authorizationRequested: lastStage = .authorizationRequested
        }
    }
    func annotating(_ failure: LocationFailure, isActive: Bool) -> LocationFailure {
        var result = failure
        result.diagnostics = LocationRequestDiagnostics(firstAuthorizationCallbackMs: firstAuthorizationCallbackMs,
            activationRequested: activationRequested, didBecomeActiveReceived: didBecomeActiveReceived,
            lastStage: lastStage, isActive: isActive)
        return result
    }
}
struct LocationSample: Codable {
    let latitude: Double
    let longitude: Double
    let altitude: Double
    let horizontalAccuracy: Double
    let verticalAccuracy: Double
    let speed: Double
    let speedAccuracy: Double
    let course: Double
    let courseAccuracy: Double
    let timestamp: String
    init(_ value: CLLocation) {
        latitude = value.coordinate.latitude; longitude = value.coordinate.longitude
        altitude = value.altitude; horizontalAccuracy = value.horizontalAccuracy
        verticalAccuracy = value.verticalAccuracy; speed = value.speed; speedAccuracy = value.speedAccuracy
        course = value.course; courseAccuracy = value.courseAccuracy
        timestamp = ISO8601DateFormatter().string(from: value.timestamp)
    }
}
struct LocationResponse: Codable {
    let action: String
    let ok: Bool
    let outcome: String
    let subject: Identity
    let authorization: String
    let authorizationRaw: Int
    let servicesEnabled: Bool
    let accuracyAuthorization: String
    let callbackReceived: Bool
    let requestIssued: Bool
    let collectionStarted: Bool
    let elapsedMs: Int
    let location: LocationSample?
    let failure: LocationFailure?
}
// Pure policy is shared by the live delegate and non-OS unit tests. Never turn
// notDetermined, an unknown future status, or global service state into a grant.
enum LocationPolicy {
    static func authorization(_ value: CLAuthorizationStatus) -> String {
        switch value {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedAlways: return "authorizedAlways"
        @unknown default: return "unknown"
        }
    }
    static func authorized(_ value: CLAuthorizationStatus) -> Bool {
        value == .authorizedAlways
    }
    static func collectFailure(_ value: CLAuthorizationStatus, services: Bool) -> LocationFailure? {
        // Preserve the authorization distinction even if services are also off.
        if !authorized(value) {
            let code: String
            switch value {
            case .denied: code = "LOCATION_DENIED"
            case .restricted: code = "LOCATION_RESTRICTED"
            case .notDetermined: code = "LOCATION_NOT_DETERMINED"
            default: code = "LOCATION_AUTHORIZATION_UNKNOWN"
            }
            return LocationFailure(code: code, message: "Native location authorization is not granted.")
        }
        return services ? nil : LocationFailure(code: "LOCATION_SERVICES_DISABLED", message: "macOS Location Services are disabled.")
    }
    static func timeout(_ args: [String: Any]) throws -> TimeInterval {
        guard let action = args["action"] as? String,
              ["location-status", "location-request", "location-collect"].contains(action),
              Set(args.keys).isSubset(of: ["action", "timeout"]) else {
            throw LocationFailure(code: "LOCATION_INVALID_ARGUMENT", message: "Expected location action and optional timeout only.")
        }
        guard let value = args["timeout"] else {
            return action == "location-status" ? 2 : action == "location-request" ? 60 : 10
        }
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue > 0, number.doubleValue <= 60 else {
            throw LocationFailure(code: "LOCATION_INVALID_ARGUMENT", message: "Expected 0 < timeout <= 60 seconds.")
        }
        return number.doubleValue
    }
}

// One object owns the manager, delegate and continuation through completion.
// Uses the existing NSApplication main runloop; no extra host, thread or TCC path.
@MainActor final class HelperLocation: NSObject, @preconcurrency CLLocationManagerDelegate {
    private var manager: CLLocationManager?
    private var continuation: CheckedContinuation<LocationResponse, Never>?
    private var watcher: Task<Void, Never>?
    private var activationObserver: NSObjectProtocol?
    private var deadline: TimeInterval = 0
    private var started = ProcessInfo.processInfo.systemUptime
    private var requestTrace = LocationRequestTrace(started: ProcessInfo.processInfo.systemUptime)
    private var action = "location-status"
    private var callbackReceived = false
    private var collecting = false
    private var requested = false
    private var finished = false
    private let subject: Identity
    init(subject: Identity) { self.subject = subject }

    func run(_ args: [String: Any]) async -> LocationResponse {
        action = args["action"] as? String ?? "location-status"
        started = ProcessInfo.processInfo.systemUptime
        requestTrace = LocationRequestTrace(started: started)
        let timeout: TimeInterval
        do { timeout = try LocationPolicy.timeout(args); try checkCancellation() }
        catch let error as LocationFailure { return response("error", error) }
        catch { return response("cancelled", LocationFailure(code: "LOCATION_CANCELLED", message: "Location operation cancelled.")) }
        deadline = started + timeout
        return await withTaskCancellationHandler {
            await withCheckedContinuation { pending in
                continuation = pending
                if Task.isCancelled {
                    finish("cancelled", LocationFailure(code: "LOCATION_CANCELLED", message: "Location operation cancelled.")); return
                }
                requestTrace.record(.waitingForAuthorizationCallback)
                let current = CLLocationManager()
                manager = current
                current.delegate = self
                watcher = Task { @MainActor [self] in
                    while !Task.isCancelled && !finished {
                        do { try checkCancellation() }
                        catch { finish("cancelled", LocationFailure(code: "LOCATION_CANCELLED", message: "Location operation cancelled.")); return }
                        if ProcessInfo.processInfo.systemUptime >= deadline {
                            finish("timeout", LocationFailure(code: "LOCATION_TIMEOUT", message: "Location operation exceeded its deadline.")); return
                        }
                        do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
                    }
                }
                // Await the first real initialization callback before deciding
                // whether to request or collect. An early status read can still
                // be notDetermined while CoreLocation is initializing.
            }
        } onCancel: {
            Task { @MainActor [self] in
                finish("cancelled", LocationFailure(code: "LOCATION_CANCELLED", message: "Location operation cancelled."))
            }
        }
    }
    private func response(_ outcome: String, _ failure: LocationFailure? = nil, location: CLLocation? = nil) -> LocationResponse {
        let failure = action == "location-request" ? failure.map {
            requestTrace.annotating($0, isActive: NSApplication.shared.isActive)
        } : failure
        let authorization = manager?.authorizationStatus
        let accuracy: String
        switch manager?.accuracyAuthorization {
        case .fullAccuracy?: accuracy = "full"
        case .reducedAccuracy?: accuracy = "reduced"
        default: accuracy = "unknown"
        }
        return LocationResponse(action: action, ok: failure == nil, outcome: outcome, subject: subject,
            authorization: authorization.map(LocationPolicy.authorization) ?? "unknown",
            authorizationRaw: authorization.map { Int($0.rawValue) } ?? -1,
            servicesEnabled: CLLocationManager.locationServicesEnabled(), accuracyAuthorization: accuracy,
            callbackReceived: callbackReceived, requestIssued: requested, collectionStarted: collecting, elapsedMs: Int((ProcessInfo.processInfo.systemUptime - started) * 1000),
            location: location.map(LocationSample.init), failure: failure)
    }
    private func finish(_ outcome: String, _ failure: LocationFailure? = nil, location: CLLocation? = nil) {
        guard !finished else { return }
        finished = true
        let result = response(outcome, failure, location: location)
        watcher?.cancel(); watcher = nil
        if let activationObserver { NotificationCenter.default.removeObserver(activationObserver) }
        activationObserver = nil
        if collecting { manager?.stopUpdatingLocation() }
        manager?.delegate = nil
        manager = nil
        let pending = continuation; continuation = nil
        pending?.resume(returning: result)
    }
    private func resolveAuthorization() {
        guard let manager, !finished else { return }
        guard canContinue() else { return }
        let value = manager.authorizationStatus
        if action == "location-status" { finish("observed"); return }
        if action == "location-request" && value == .notDetermined {
            guard !requested else { return }
            guard CLLocationManager.locationServicesEnabled() else {
                finish("error", LocationFailure(code: "LOCATION_SERVICES_DISABLED", message: "macOS Location Services are disabled.")); return
            }
            if activationObserver == nil {
                activationObserver = NotificationCenter.default.addObserver(
                    forName: NSApplication.didBecomeActiveNotification, object: NSApplication.shared, queue: .main
                ) { [weak self] _ in
                    Task { @MainActor in
                        guard let self, !self.finished else { return }
                        self.requestTrace.record(.didBecomeActive)
                        self.requestIfActive()
                    }
                }
                // Only the explicit request path may activate. Calling the OS
                // API immediately after activate() can be too early; wait for
                // the real didBecomeActive event (or already-active state).
                requestTrace.record(.activationRequested)
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
            requestIfActive()
            return
        }
        if let error = LocationPolicy.collectFailure(value, services: CLLocationManager.locationServicesEnabled()) {
            finish("error", error)
        } else if action == "location-request" { finish("authorized") }
        else if action == "location-collect" && !collecting {
            collecting = true
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.requestLocation()
        }
    }
    private func canContinue() -> Bool {
        guard !finished else { return false }
        do { try checkCancellation() }
        catch { finish("cancelled", LocationFailure(code: "LOCATION_CANCELLED", message: "Location operation cancelled.")); return false }
        guard ProcessInfo.processInfo.systemUptime < deadline else {
            finish("timeout", LocationFailure(code: "LOCATION_TIMEOUT", message: "Location operation exceeded its deadline.")); return false
        }
        return true
    }
    private func requestIfActive() {
        guard canContinue(), !requested, NSApplication.shared.isActive,
              let manager, manager.authorizationStatus == .notDetermined else { return }
        requested = true
        requestTrace.record(.authorizationRequested)
        manager.requestWhenInUseAuthorization()
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        callbackReceived = true
        if !finished { requestTrace.record(.authorizationCallback) }
        resolveAuthorization()
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard action == "location-collect", !finished else { return }
        guard canContinue() else { return }
        if let error = LocationPolicy.collectFailure(manager.authorizationStatus, services: CLLocationManager.locationServicesEnabled()) {
            finish("error", error); return
        }
        guard let value = locations.last(where: { $0.horizontalAccuracy >= 0 && CLLocationCoordinate2DIsValid($0.coordinate) }) else {
            finish("error", LocationFailure(code: "LOCATION_NO_FIX", message: "CoreLocation returned no valid fix.")); return
        }
        finish("collected", location: value)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard canContinue() else { return }
        let native = error as NSError
        let denied = native.domain == kCLErrorDomain && native.code == CLError.denied.rawValue
        finish("error", LocationFailure(code: denied ? "LOCATION_DENIED" : "LOCATION_NATIVE_ERROR",
            message: "CoreLocation reported an error.", domain: native.domain, nativeCode: native.code))
    }
}
