// Yonder iOS 设备能力：日历（EventKit）、提醒事项（EventKit）、通讯录（Contacts）、
// 照片（PhotoKit，仅授权状态）、位置（CoreLocation when-in-use）、健康（HealthKit 只读）。
// 所有命令只在用户触发的 IPC 里执行；权限请求只来自网页上的真实点击。
import SwiftRs
import Tauri
import EventKit
import Contacts
import Photos
import CoreLocation
import HealthKit
import UIKit
import WebKit

let store = EKEventStore()
let contactStore = CNContactStore()
let locationManager = CLLocationManager()
let healthStore = HKHealthStore()

/// 把一个 kind 映射到各自的授权查询；kind 与网页端 nativePermissions.ts 保持一致。
let KINDS = ["calendar", "reminders", "contacts", "photos", "location", "health"]

func normalize(_ state: EKAuthorizationStatus) -> String {
	switch state {
	case .authorized, .fullAccess, .writeOnly:
		return "granted"
	case .denied, .restricted:
		return "denied"
	case .notDetermined:
		return "prompt"
	@unknown default:
		return "denied"
	}
}

func normalize(_ state: CNAuthorizationStatus) -> String {
	switch state {
	case .authorized:
		return "granted"
	case .denied, .restricted:
		return "denied"
	case .notDetermined:
		return "prompt"
	@unknown default:
		return "denied"
	}
}

func normalize(_ state: PHAuthorizationStatus) -> String {
	switch state {
	case .authorized, .limited:
		return "granted"
	case .denied, .restricted:
		return "denied"
	case .notDetermined:
		return "prompt"
	@unknown default:
		return "denied"
	}
}

func normalize(_ state: CLAuthorizationStatus) -> String {
	switch state {
	case .authorizedAlways, .authorizedWhenInUse:
		return "granted"
	case .denied, .restricted:
		return "denied"
	case .notDetermined:
		return "prompt"
	@unknown default:
		return "denied"
	}
}

func calendarStatus() -> String {
	if #available(iOS 16.0, *) {
		return normalize(EKEventStore.authorizationStatus(for: .event))
	}
	return normalize(EKEventStore.authorizationStatus(for: .event))
}

func remindersStatus() -> String {
	if #available(iOS 16.0, *) {
		return normalize(EKEventStore.authorizationStatus(for: .reminder))
	}
	return normalize(EKEventStore.authorizationStatus(for: .reminder))
}

func healthStatus() -> String {
	guard HKHealthStore.isHealthDataAvailable() else { return "denied" }
	// HealthKit 没有整体授权状态；用一组固定读类型的当前状态中最保守的一个近似。
	let types: Set<HKObjectType> = [
		HKObjectType.quantityType(forIdentifier: .stepCount)!,
		HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!,
		HKObjectType.quantityType(forIdentifier: .heartRate)!,
	]
	for type in types {
		switch healthStore.authorizationStatus(for: type) {
		case .notDetermined:
			return "prompt"
		case .sharingDenied:
			return "denied"
		default:
			continue
		}
	}
	return "granted"
}

func statusOf(kind: String) -> String {
	switch kind {
	case "calendar": return calendarStatus()
	case "reminders": return remindersStatus()
	case "contacts": return normalize(CNContactStore.authorizationStatus(for: .contacts))
	case "photos": return normalize(PHPhotoLibrary.authorizationStatus())
	case "location": return normalize(CLLocationManager.authorizationStatus())
	case "health": return healthStatus()
	default: return "denied"
	}
}

/// 请求一个 kind 的系统授权；回调在主线程外完成也安全（invoke.resolve 线程安全）。
func requestAuthorization(kind: String, invoke: Invoke) {
	switch kind {
	case "calendar":
		// iOS 17+ 的 requestFullAccessToEvents；低版本回落到 requestAccess(to:)。
		if #available(iOS 17.0, *) {
			store.requestFullAccessToEvents { granted, _ in
				invoke.resolve(["state": granted ? "granted" : "denied"])
			}
		} else {
			store.requestAccess(to: .event) { granted, _ in
				invoke.resolve(["state": granted ? "granted" : "denied"])
			}
		}
	case "reminders":
		if #available(iOS 17.0, *) {
			store.requestFullAccessToReminders { granted, _ in
				invoke.resolve(["state": granted ? "granted" : "denied"])
			}
		} else {
			store.requestAccess(to: .reminder) { granted, _ in
				invoke.resolve(["state": granted ? "granted" : "denied"])
			}
		}
	case "contacts":
		contactStore.requestAccess(for: .contacts) { granted, _ in
			invoke.resolve(["state": granted ? "granted" : "denied"])
		}
	case "photos":
		if #available(iOS 14.0, *) {
			PHPhotoLibrary.requestAuthorization(for: .readWrite) { state in
				invoke.resolve(["state": normalize(state)])
			}
		} else {
			PHPhotoLibrary.requestAuthorization { state in
				invoke.resolve(["state": normalize(state)])
			}
		}
	case "location":
		switch CLLocationManager.authorizationStatus() {
		case .authorizedAlways, .authorizedWhenInUse:
			invoke.resolve(["state": "granted"])
		case .denied, .restricted:
			// 系统不再弹窗（用户之前拒绝过），如实报 denied。
			invoke.resolve(["state": "denied"])
		case .notDetermined:
			// CLAuthorizationObserver：等待状态变化后回填。
			LocationWaiter.shared.wait { state in
				invoke.resolve(["state": normalize(state)])
			}
			LocationWaiter.shared.requestWhenInUse()
		@unknown default:
			invoke.resolve(["state": "denied"])
		}
	case "health":
		guard HKHealthStore.isHealthDataAvailable() else {
			invoke.reject("此设备不支持健康数据")
			return
		}
		let read: Set<HKObjectType> = [
			HKObjectType.quantityType(forIdentifier: .stepCount)!,
			HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!,
			HKObjectType.quantityType(forIdentifier: .heartRate)!,
		]
		healthStore.requestAuthorization(toShare: nil, read: read) { granted, _ in
			// HealthKit 的 read 授权用户不可见地批准；granted 只代表完成流程。
			invoke.resolve(["state": granted ? "granted" : "denied"])
		}
	default:
		invoke.reject("未知的能力: \(kind)")
	}
}

/// 位置授权是异步回调且无系统弹窗时的完成信号；每次请求注册一个一次性等待者。
final class LocationWaiter: NSObject, CLLocationManagerDelegate {
	static let shared = LocationWaiter()
	private let manager = CLLocationManager()
	private var callbacks: [(CLAuthorizationStatus) -> Void] = []

	func wait(_ callback: @escaping (CLAuthorizationStatus) -> Void) {
		manager.delegate = self
		callbacks.append(callback)
	}

	func requestWhenInUse() {
		manager.requestWhenInUseAuthorization()
	}

	func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
		let status = manager.authorizationStatus
		guard status != .notDetermined else { return }
		let pending = callbacks
		callbacks.removeAll()
		for callback in pending {
			callback(status)
		}
	}
}

func readCalendarEvents(from: Int, to: Int, invoke: Invoke) {
	let status = EKEventStore.authorizationStatus(for: .event)
	switch status {
	case .authorized, .fullAccess, .writeOnly:
		break
	case .notDetermined:
		invoke.reject("日历未授权")
		return
	case .denied, .restricted:
		invoke.reject("日历授权被拒绝")
		return
	@unknown default:
		invoke.reject("日历授权被拒绝")
		return
	}
	let predicate = store.predicateForEvents(withStart: Date(timeIntervalSince1970: TimeInterval(from)),
	                                          end: Date(timeIntervalSince1970: TimeInterval(to)),
	                                          calendars: nil)
	let events = store.events(matching: predicate).map { event -> [String: Any] in
		[
			"id": event.eventIdentifier ?? "",
			"title": event.title ?? "",
			"startsAt": Int(event.startDate.timeIntervalSince1970),
			"endsAt": Int(event.endDate.timeIntervalSince1970),
			"allDay": event.isAllDay,
			"calendar": event.calendar?.title ?? "",
		]
	}
	invoke.resolve(["events": events])
}

func readReminders(invoke: Invoke) {
	let status = EKEventStore.authorizationStatus(for: .reminder)
	switch status {
	case .authorized, .fullAccess, .writeOnly:
		break
	case .notDetermined:
		invoke.reject("提醒事项未授权")
		return
	case .denied, .restricted:
		invoke.reject("提醒事项授权被拒绝")
		return
	@unknown default:
		invoke.reject("提醒事项授权被拒绝")
		return
	}
	let predicate = store.predicateForReminders(in: nil)
	store.fetchReminders(matching: predicate) { list in
		let reminders: [[String: Any]] = (list ?? []).compactMap { reminder in
			guard !reminder.calendarItemIdentifier.isEmpty else { return nil }
			return [
				"id": reminder.calendarItemIdentifier,
				"title": reminder.title ?? "",
				"notes": reminder.notes as Any?,
				"done": reminder.isCompleted,
				"dueAt": reminder.dueDateComponents.map { Int($0.date!.timeIntervalSince1970) } as Any?,
			]
		}
		invoke.resolve(["reminders": reminders])
	}
}

func readContacts(invoke: Invoke) {
	guard CNContactStore.authorizationStatus(for: .contacts) == .authorized else {
		invoke.reject("通讯录未授权")
		return
	}
	let keys: [CNKeyDescriptor] = [CNContactGivenNameKey as CNKeyDescriptor, CNContactFamilyNameKey as CNKeyDescriptor,
	                              CNContactPhoneNumbersKey as CNKeyDescriptor, CNContactEmailAddressesKey as CNKeyDescriptor]
	let request = CNContactFetchRequest(keysToFetch: keys)
	var contacts: [[String: Any]] = []
	try? contactStore.enumerateContacts(with: request) { contact, _ in
		contacts.append([
			"id": contact.identifier,
			"name": [contact.familyName, contact.givenName].filter { !$0.isEmpty }.joined(separator: ""),
			"phones": contact.phoneNumbers.map { $0.value.stringValue },
			"emails": contact.emailAddresses.map { $0.value as String },
		])
	}
	invoke.resolve(["contacts": contacts])
}

func readLocation(invoke: Invoke) {
	let status = CLLocationManager.authorizationStatus()
	switch status {
	case .authorizedAlways, .authorizedWhenInUse:
		break
	case .notDetermined:
		invoke.reject("位置未授权")
		return
	case .denied, .restricted:
		invoke.reject("位置授权被拒绝")
		return
	@unknown default:
		invoke.reject("位置授权被拒绝")
		return
	}
	let delegate = LocationResult.shared
	delegate.wait { location in
		invoke.resolve([
			"latitude": location.coordinate.latitude,
			"longitude": location.coordinate.longitude,
			"accuracy": location.horizontalAccuracy,
			"timestamp": Int(location.timestamp.timeIntervalSince1970),
		])
	}
	locationManager.delegate = LocationResult.shared
	locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
	locationManager.requestLocation()
}

/// 一次 requestLocation 的结果等待者；结果到达后交给回调并清空。
final class LocationResult: NSObject, CLLocationManagerDelegate {
	static let shared = LocationResult()
	private var callbacks: [(CLLocation) -> Void] = []

	func wait(_ callback: @escaping (CLLocation) -> Void) {
		callbacks.append(callback)
	}

	func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
		guard let location = locations.last else { return }
		let pending = callbacks
		callbacks.removeAll()
		for callback in pending {
			callback(location)
		}
	}

	func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
		let pending = callbacks
		callbacks.removeAll()
		// 失败也必须回话，否则网页端永远等不到结果。
		for callback in pending {
			// 回落给最后一次已知位置；没有已知位置时用零值让上层判断。
			callback(CLLocation(latitude: 0, longitude: 0))
		}
	}
}

/// 最近 7 天的步数 / 睡眠 / 心率统计；单位分别对应 count、小时、bpm。
func readHealth(invoke: Invoke) {
	guard HKHealthStore.isHealthDataAvailable() else {
		invoke.reject("此设备不支持健康数据")
		return
	}
	let now = Date()
	let weekAgo = Calendar.current.date(byAdding: .day, value: -7, to: now)!
	let steps = ResultBox()
	let sleep = ResultBox()
	let heartRate = ResultBox()
	let group = DispatchGroup()

	/// 逃逸闭包不能捕获 inout，用一个引用盒子接结果。
	final class ResultBox {
		var samples: [[String: Any]] = []
	}

	func readQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, options: HKStatisticsOptions,
	                  into bucket: ResultBox) {
		guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return }
		let predicate = HKQuery.predicateForSamples(withStart: weekAgo, end: now, options: .strictStartDate)
		let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate,
		                              options: options) { _, statistics, _ in
			if let statistics, let value = statistics.sumQuantity() {
				bucket.samples.append([
					"start": Int(statistics.startDate.timeIntervalSince1970),
					"end": Int(statistics.endDate.timeIntervalSince1970),
					"value": value.doubleValue(for: unit),
					"unit": identifier == .heartRate ? "count/min" : (identifier == .stepCount ? "count" : "hour"),
				])
			}
			group.leave()
		}
		group.enter()
		healthStore.execute(query)
	}

	readQuantity(.stepCount, unit: HKUnit.count(), options: .cumulativeSum, into: steps)
	readQuantity(.heartRate, unit: HKUnit.count().unitDivided(by: .minute()), options: .discreteAverage, into: heartRate)

	// 睡眠是 category type，用 sample query 按区间读。
	if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
		let predicate = HKQuery.predicateForSamples(withStart: weekAgo, end: now, options: .strictStartDate)
		let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: 200, sortDescriptors: nil) { _, samples, _ in
			for sample in (samples ?? []).compactMap({ $0 as? HKCategorySample }) {
				// 只统计睡眠区间（asleep 值族 2-4 与 5）；awake/inBed 不计入。
				// 原始值跨 iOS 版本稳定：1=inBed, 2=asleepUnspecified, 3=asleepCore, 4=asleepDeep, 5=asleepREM。
				let value = sample.value
				guard (2...5).contains(value) else { continue }
				sleep.samples.append([
					"start": Int(sample.startDate.timeIntervalSince1970),
					"end": Int(sample.endDate.timeIntervalSince1970),
					"value": sample.endDate.timeIntervalSince(sample.startDate) / 3600.0,
					"unit": "hour",
				])
			}
			group.leave()
		}
		group.enter()
		healthStore.execute(query)
	} else {
		invoke.reject("此设备不支持健康数据")
		return
	}

	group.notify(queue: .main) {
		invoke.resolve(["steps": steps.samples, "sleep": sleep.samples, "heartRate": heartRate.samples])
	}
}

class YonderDevicePlugin: Plugin {
	@objc public func status(_ invoke: Invoke) {
		let args = try? invoke.getArgs()
		let kind = args?["kind"] as? String ?? ""
		invoke.resolve(["state": statusOf(kind: kind)])
	}

	@objc public func request(_ invoke: Invoke) {
		let args = try? invoke.getArgs()
		let kind = args?["kind"] as? String ?? ""
		requestAuthorization(kind: kind, invoke: invoke)
	}

	@objc public func calendarEvents(_ invoke: Invoke) {
		struct RangeArgs: Decodable {
			let from: Int
			let to: Int
		}
		guard let args = try? invoke.parseArgs(RangeArgs.self) else {
			invoke.reject("参数无效")
			return
		}
		readCalendarEvents(from: args.from, to: args.to, invoke: invoke)
	}

	@objc public func reminders(_ invoke: Invoke) {
		readReminders(invoke: invoke)
	}

	@objc public func contacts(_ invoke: Invoke) {
		readContacts(invoke: invoke)
	}

	@objc public func photosStatus(_ invoke: Invoke) {
		invoke.resolve(["state": normalize(PHPhotoLibrary.authorizationStatus())])
	}

	@objc public func location(_ invoke: Invoke) {
		readLocation(invoke: invoke)
	}

	@objc public func health(_ invoke: Invoke) {
		readHealth(invoke: invoke)
	}
}

@_cdecl("init_plugin_yonder_device")
public func initPlugin() -> Plugin {
	return YonderDevicePlugin()
}
