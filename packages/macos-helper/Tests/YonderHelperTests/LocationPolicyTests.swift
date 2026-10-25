import CoreLocation
import XCTest
@testable import YonderHelper

final class LocationPolicyTests: XCTestCase {
    func testNativeStatusesStayDistinct() {
        XCTAssertEqual(LocationPolicy.authorization(.notDetermined), "notDetermined")
        XCTAssertEqual(LocationPolicy.authorization(.denied), "denied")
        XCTAssertEqual(LocationPolicy.authorization(.restricted), "restricted")
        XCTAssertEqual(LocationPolicy.authorization(.authorizedAlways), "authorizedAlways")
    }
    func testOnlyNativeAuthorizationPermitsCollection() {
        for status: CLAuthorizationStatus in [.notDetermined, .denied, .restricted] {
            XCTAssertFalse(LocationPolicy.authorized(status))
            XCTAssertNotNil(LocationPolicy.collectFailure(status, services: true))
        }
        XCTAssertTrue(LocationPolicy.authorized(.authorizedAlways))
        XCTAssertNil(LocationPolicy.collectFailure(.authorizedAlways, services: true))
    }
    func testAuthorizationFailuresAreNotGlobalServiceOrRequestedStates() {
        XCTAssertEqual(LocationPolicy.collectFailure(.notDetermined, services: false)?.code, "LOCATION_NOT_DETERMINED")
        XCTAssertEqual(LocationPolicy.collectFailure(.denied, services: false)?.code, "LOCATION_DENIED")
        XCTAssertEqual(LocationPolicy.collectFailure(.restricted, services: false)?.code, "LOCATION_RESTRICTED")
        XCTAssertEqual(LocationPolicy.collectFailure(.authorizedAlways, services: false)?.code, "LOCATION_SERVICES_DISABLED")
    }
    func testFutureNativeStatusFailsClosed() {
        let future = CLAuthorizationStatus(rawValue: 99)!
        XCTAssertEqual(LocationPolicy.authorization(future), "unknown")
        XCTAssertFalse(LocationPolicy.authorized(future))
        XCTAssertEqual(LocationPolicy.collectFailure(future, services: true)?.code, "LOCATION_AUTHORIZATION_UNKNOWN")
    }
    func testDefaultDeadlines() throws {
        XCTAssertEqual(try LocationPolicy.timeout(["action": "location-status"]), 2)
        XCTAssertEqual(try LocationPolicy.timeout(["action": "location-request"]), 60)
        XCTAssertEqual(try LocationPolicy.timeout(["action": "location-collect"]), 10)
    }
    func testBoundedDeadlines() throws {
        for value in [0.001, 1, 60] {
            XCTAssertEqual(try LocationPolicy.timeout(["action": "location-collect", "timeout": value]), value)
        }
        for value: Any in [0, -1, 61, Double.nan, Double.infinity, "1", true, NSNull()] {
            XCTAssertThrowsError(try LocationPolicy.timeout(["action": "location-collect", "timeout": value]))
        }
    }
    func testStrictArguments() {
        for args: [String: Any] in [["action": "collect"], [:], ["action": "location-status", "request": true], ["action": "location-collect", "latitude": 0]] {
            XCTAssertThrowsError(try LocationPolicy.timeout(args)) { error in
                XCTAssertEqual((error as? LocationFailure)?.code, "LOCATION_INVALID_ARGUMENT")
            }
        }
    }
    func testFailureWireSchemaHasNoLocationOrInventedGrant() throws {
        let error = LocationFailure(code: "LOCATION_TIMEOUT", message: "Deadline exceeded.")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(error)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), Set(["code", "message"]))
    }
}
