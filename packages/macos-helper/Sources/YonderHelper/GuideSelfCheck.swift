import Foundation

// Invoked by yonder-permissions self-check; recorded frames are from the C3 live run.
func guideSelfCheck(identity: Identity) -> Int {
    var count = 0
    func check(_ condition: Bool) { precondition(condition); count += 1 }
    let screen = CGRect(x: 0, y: 0, width: 2560, height: 1410)
    let settings = CGRect(x: 601, y: 244, width: 740, height: 923)
    let size = CGSize(width: 510, height: 96)
    for (list, expectedY) in [(CGRect(x: 853, y: 404, width: 468, height: 630), CGFloat(300)),
                              (CGRect(x: 853, y: 668, width: 468, height: 379), CGFloat(564))] {
        let result = guideFrame(settings: settings, list: list, screen: screen, size: size)
        check(result == CGRect(x: 853, y: expectedY, width: 468, height: 96))
        check(result.maxY == list.minY - 8 && !result.intersects(list) && screen.contains(result))
        // A translated recorded frame is a pure computation check, not a live window move.
        let shifted = guideFrame(settings: settings.offsetBy(dx: 80, dy: 40), list: list.offsetBy(dx: 80, dy: 40), screen: screen, size: size)
        check(shifted == result.offsetBy(dx: 80, dy: 40))
    }
    // Real opening-animation frame, before AX could see the list.
    let opening = CGRect(x: 497, y: 222, width: 547, height: 710)
    let fallback = guideFrame(settings: opening, list: nil, screen: screen, size: CGSize(width: 317, height: 96))
    check(fallback == CGRect(x: 727, y: 118, width: 317, height: 96))
    check(guideFrame(settings: settings.offsetBy(dx: 0, dy: -230), list: nil, screen: screen, size: size).isEmpty)
    let secondary = screen.offsetBy(dx: -2560, dy: 300)
    let other = guideFrame(settings: settings.offsetBy(dx: -2560, dy: 300), list: nil, screen: secondary, size: size)
    check(secondary.contains(other))

    let yes = Probe(kind: "screen-recording", granted: true, observable: true, raw: "recorded grant transition"),
        no = Probe(kind: "screen-recording", granted: false, observable: true, raw: "CGPreflightScreenCaptureAccess=false (C3 live)")
    let asked = transition(no, previous: nil, identity: identity, now: "1", requested: true)
    let restart = transition(no, previous: asked, identity: identity, now: "2", restartNeeded: true)
    check(restart.state == "needs-restart" && restart.lastRequestedAt == "1")
    let granted = transition(yes, previous: restart, identity: identity, now: "3")
    check(granted.state == "granted" && granted.grantedAt == "3")
    check(transition(yes, previous: granted, identity: identity, now: "4").grantedAt == "3")
    let revoked = transition(no, previous: granted, identity: identity, now: "5")
    check(revoked.state == "revoked-detected")
    check(transition(no, previous: revoked, identity: identity, now: "6", interrupted: true).state == "revoked-detected")
    let interrupted = transition(no, previous: asked, identity: identity, now: "6", interrupted: true)
    check(interrupted.state == "requested" && interrupted.lastRequestedAt == "1")
    check(transition(no, previous: nil, identity: identity, now: "6", interrupted: true).state == "not-granted")
    check(observationOutcome(state: "granted", closed: false, timedOut: false) == "granted")
    check(observationOutcome(state: "granted", closed: true, timedOut: false) == "closed")
    check(observationOutcome(state: "granted", closed: false, timedOut: true) == "granted")
    check(observationOutcome(state: "requested", closed: false, timedOut: true) == "timeout")
    check(observationOutcome(state: "revoked-detected", closed: false, timedOut: false) == nil)
    return count
}
