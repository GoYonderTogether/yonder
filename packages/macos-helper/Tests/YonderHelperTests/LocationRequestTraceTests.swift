import Foundation
import XCTest
@testable import YonderHelper

// Pure event/clock tests. No CLLocationManager, NSApplication, OS request or fix.
final class LocationRequestTraceTests: XCTestCase {
    private func timeout(_ trace: LocationRequestTrace, active: Bool = false) throws -> [String: Any] {
        let failure = trace.annotating(LocationFailure(code: "LOCATION_TIMEOUT", message: "Location operation exceeded its deadline."), isActive: active)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(failure)) as? [String: Any])
        XCTAssertEqual(object["code"] as? String, "LOCATION_TIMEOUT")
        return try XCTUnwrap(object["diagnostics"] as? [String: Any])
    }

    func testFailureBeforeManagerInitialization() throws {
        let trace = LocationRequestTrace(started: 100, now: { 100 })
        let result = try timeout(trace)
        XCTAssertEqual(result["lastStage"] as? String, "validatingArguments")
        XCTAssertNil(result["firstAuthorizationCallbackMs"])
    }

    func testTimeoutBeforeAnyCallback() throws {
        var trace = LocationRequestTrace(started: 100, now: { 160 })
        trace.record(.waitingForAuthorizationCallback)
        let result = try timeout(trace)
        XCTAssertEqual(result["lastStage"] as? String, "waitingForAuthorizationCallback")
        XCTAssertNil(result["firstAuthorizationCallbackMs"])
        XCTAssertEqual(result["activationRequested"] as? Bool, false)
        XCTAssertEqual(result["didBecomeActiveReceived"] as? Bool, false)
        XCTAssertEqual(result["isActive"] as? Bool, false)
    }

    func testFirstCallbackUsesInjectedMonotonicClockAndIsNotOverwritten() throws {
        var time: TimeInterval = 100.125
        var trace = LocationRequestTrace(started: 100, now: { time })
        trace.record(.waitingForAuthorizationCallback)
        trace.record(.authorizationCallback)
        time = 130
        trace.record(.authorizationCallback)
        let result = try timeout(trace)
        XCTAssertEqual(result["firstAuthorizationCallbackMs"] as? Int, 125)
        XCTAssertEqual(result["lastStage"] as? String, "authorizationCallbackReceived")
    }

    func testTimeoutWaitingForActivationWithoutNotification() throws {
        var trace = LocationRequestTrace(started: 100, now: { 100.25 })
        trace.record(.authorizationCallback)
        trace.record(.activationRequested)
        let result = try timeout(trace)
        XCTAssertEqual(result["firstAuthorizationCallbackMs"] as? Int, 250)
        XCTAssertEqual(result["lastStage"] as? String, "waitingForActivation")
        XCTAssertEqual(result["activationRequested"] as? Bool, true)
        XCTAssertEqual(result["didBecomeActiveReceived"] as? Bool, false)
    }

    func testNotificationDoesNotClaimAppIsStillActiveOrRequestWasIssued() throws {
        var trace = LocationRequestTrace(started: 100, now: { 101 })
        trace.record(.authorizationCallback)
        trace.record(.activationRequested)
        trace.record(.didBecomeActive)
        let result = try timeout(trace, active: false)
        XCTAssertEqual(result["didBecomeActiveReceived"] as? Bool, true)
        XCTAssertEqual(result["isActive"] as? Bool, false)
        XCTAssertEqual(result["lastStage"] as? String, "waitingForActivation")
    }

    func testTimeoutAfterNotificationAndSingleRequest() throws {
        var trace = LocationRequestTrace(started: 100, now: { 100.5 })
        for event: LocationRequestTrace.Event in [.waitingForAuthorizationCallback, .authorizationCallback, .activationRequested, .didBecomeActive, .authorizationRequested, .authorizationCallback] {
            trace.record(event)
        }
        let result = try timeout(trace, active: true)
        XCTAssertEqual(result["firstAuthorizationCallbackMs"] as? Int, 500)
        XCTAssertEqual(result["lastStage"] as? String, "authorizationRequested")
        XCTAssertEqual(result["didBecomeActiveReceived"] as? Bool, true)
        XCTAssertEqual(result["isActive"] as? Bool, true)
    }

    func testAlreadyActivePathDoesNotInventNotification() throws {
        var trace = LocationRequestTrace(started: 100, now: { 101 })
        trace.record(.authorizationCallback)
        trace.record(.activationRequested)
        trace.record(.authorizationRequested)
        let result = try timeout(trace, active: true)
        XCTAssertEqual(result["lastStage"] as? String, "authorizationRequested")
        XCTAssertEqual(result["didBecomeActiveReceived"] as? Bool, false)
        XCTAssertEqual(result["isActive"] as? Bool, true)
    }

    func testNativeFailureCodeDomainAndMessageArePreserved() {
        let trace = LocationRequestTrace(started: 100, now: { 101 })
        let original = LocationFailure(code: "LOCATION_NATIVE_ERROR", message: "CoreLocation reported an error.", domain: "kCLErrorDomain", nativeCode: 0)
        let failure = trace.annotating(original, isActive: false)
        XCTAssertEqual(failure.code, original.code)
        XCTAssertEqual(failure.message, original.message)
        XCTAssertEqual(failure.domain, original.domain)
        XCTAssertEqual(failure.nativeCode, original.nativeCode)
        XCTAssertNil(original.diagnostics)
    }

    func testCancellationRetainsLastStageWithoutInventingRequest() {
        var trace = LocationRequestTrace(started: 100, now: { 101 })
        trace.record(.authorizationCallback)
        trace.record(.activationRequested)
        let failure = trace.annotating(LocationFailure(code: "LOCATION_CANCELLED", message: "Location operation cancelled."), isActive: false)
        XCTAssertEqual(failure.code, "LOCATION_CANCELLED")
        XCTAssertEqual(failure.diagnostics?.lastStage, .waitingForActivation)
    }

    func testFailureDiagnosticsSchemaContainsOnlyAllowlistedMetadata() throws {
        var trace = LocationRequestTrace(started: 100, now: { 101 })
        trace.record(.authorizationCallback)
        let result = try timeout(trace)
        XCTAssertEqual(Set(result.keys), Set(["firstAuthorizationCallbackMs", "activationRequested", "didBecomeActiveReceived", "isActive", "lastStage"]))
        // Existing failures without request tracing keep their old wire schema.
        let untraced = LocationFailure(code: "LOCATION_DENIED", message: "Native location authorization is not granted.")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(untraced)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), Set(["code", "message"]))
    }
}
