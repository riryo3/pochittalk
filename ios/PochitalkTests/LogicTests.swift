import XCTest
@testable import Pochitalk

final class LogicTests: XCTestCase {
    func testPttGestureHoldAndRelease() {
        var g = PttGesture(center: CGPoint(x: 85, y: 85), outsideRadius: 99)
        g.onDown(0, CGPoint(x: 85, y: 85))
        XCTAssertEqual(g.onTimer(10), .none)          // まだ待ち時間
        XCTAssertEqual(g.onTimer(60), .start)         // 50ms たつと送信開始
        XCTAssertEqual(g.onMove(100, CGPoint(x: 120, y: 120)), .none) // 円の上なら滑っても続く
        XCTAssertEqual(g.onUp(), .release)
    }

    func testPttGestureShortTapDoesNothing() {
        var g = PttGesture(center: CGPoint(x: 85, y: 85), outsideRadius: 99)
        g.onDown(0, CGPoint(x: 85, y: 85))
        XCTAssertEqual(g.onUp(), .none)               // 短いタップは送信しない
    }

    func testPttGestureLeavingCircleAborts() {
        var g = PttGesture(center: CGPoint(x: 85, y: 85), outsideRadius: 99)
        g.onDown(0, CGPoint(x: 85, y: 85))
        XCTAssertEqual(g.onTimer(60), .start)
        XCTAssertEqual(g.onMove(80, CGPoint(x: 300, y: 85)), .abort) // 円の外に出たらすぐ止める
        XCTAssertEqual(g.onUp(), .none)
        var h = PttGesture(center: CGPoint(x: 85, y: 85), outsideRadius: 99)
        h.onDown(0, CGPoint(x: 85, y: 85))
        XCTAssertEqual(h.onMove(10, CGPoint(x: 300, y: 85)), .swipe) // 送信前なら、送信しない
        XCTAssertEqual(h.onTimer(100), .none)
    }

    func testRoomKeyParsing() {
        XCTAssertTrue(isRoomKey("7a0b07c1"))
        XCTAssertFalse(isRoomKey("7A0B07C1"))
        XCTAssertFalse(isRoomKey("7a0b07c"))
        XCTAssertEqual(PochiEngine.roomKey(from: URL(string: "https://pochittalk.ryota-softwares.workers.dev/?r=7A0B07C1")!), "7a0b07c1")
        XCTAssertEqual(PochiEngine.roomKey(from: URL(string: "pochitalk://join?r=1234abcd")!), "1234abcd")
        XCTAssertNil(PochiEngine.roomKey(from: URL(string: "https://example.com/?r=zzz")!))
        XCTAssertEqual(formatKey("7a0b07c1"), "7A0B·07C1")
        // 36 種類 (a〜z, 0〜9) の部屋番号。16 進の古い部屋とおうむの部屋は、そのまま通る
        XCTAssertTrue(isRoomKey("zz09az19"))
        XCTAssertTrue(isRoomKey(botRoomKey))
        // おうむの部屋: 新 (22360679 = 2236·0679) と旧 (7a0b07c1) のどちらでも、おうむの部屋
        XCTAssertEqual(botRoomKey, "22360679")
        XCTAssertEqual(formatKey(botRoomKey), "2236·0679")
        XCTAssertTrue(isBotRoom("22360679")); XCTAssertTrue(isBotRoom("7a0b07c1"))
        XCTAssertFalse(isBotRoom("5a5a1111")); XCTAssertFalse(isBotRoom(nil))
        XCTAssertFalse(isRoomKey("zz09az1"))
        XCTAssertFalse(isRoomKey("zz09az1-"))
        XCTAssertFalse(isRoomKey("ZZ09AZ19"))
        XCTAssertEqual(PochiEngine.roomKey(from: URL(string: "https://pochittalk.ryota-softwares.workers.dev/?r=ZZ09AZ19")!), "zz09az19")
        XCTAssertEqual(formatKey("zz09az19"), "ZZ09·AZ19")
    }

    func testTurnResponseParsing() {
        let json = #"{"iceServers":[{"urls":["stun:stun.cloudflare.com:3478"]},{"urls":["turn:turn.cloudflare.com:3478?transport=udp"],"username":"u","credential":"c"}]}"#
        let list = TurnClient.parse(Data(json.utf8))
        XCTAssertEqual(list?.count, 2)
        XCTAssertEqual(list?[1].username, "u")
        XCTAssertNil(TurnClient.parse(Data(#"{"iceServers":[]}"#.utf8)))
        XCTAssertNil(TurnClient.parse(Data("oops".utf8)))
    }

    func testSelfIdSortsBeforeBrowsers() {
        // 先頭が "00" の id は、ブラウザの id (英数字) より小さい → アプリが必ずオファー側になる
        XCTAssertEqual(TrysteroNetwork.selfId.count, 20)
        XCTAssertTrue(TrysteroNetwork.selfId.hasPrefix("00"))
        XCTAssertTrue(TrysteroNetwork.selfId < "0A", "ブラウザの id より小さい")
    }
}

final class SdpTests: XCTestCase {
    /// SDP は CRLF 改行。m= 行の判定が CRLF でも当たること (iPhone 同士がつながらなかった原因)。
    func testMediaSectionDetectionWithCRLF() {
        let sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n"
        XCTAssertFalse(sdp.contains("\nm="), "Swift の contains は CRLF の \\n に当たらない (これがバグの原因)")
        XCTAssertEqual(Sdp.mediaSectionCount(sdp), 1)
        XCTAssertEqual(Sdp.mediaSectionCount("v=0\r\ns=-\r\nt=0 0\r\n"), 0)
        XCTAssertEqual(Sdp.mediaSectionCount("v=0\nm=audio 9 RTP/AVP 0\nm=video 9 RTP/AVP 96\n"), 2)
    }

    func testMissingNames() {
        // 一覧に 3 人、つながっているのは 1 人 → 残り 2 人が未接続
        XCTAssertEqual(PochiEngine.missingNames(listed: ["Aさん", "Bさん", "Cさん"], connected: ["Bさん"]), ["Aさん", "Cさん"])
        // 全員つながっていれば、空
        XCTAssertEqual(PochiEngine.missingNames(listed: ["A", "B"], connected: ["B", "A"]), [])
        // 同じ名前が 2 人: つながっているのが 1 人なら、1 人ぶん残る (個数で突き合わせる)
        XCTAssertEqual(PochiEngine.missingNames(listed: ["同名", "同名"], connected: ["同名"]), ["同名"])
        // 12 文字より長い名前は、先頭 12 文字で突き合わせる
        XCTAssertEqual(PochiEngine.missingNames(listed: ["123456789012"], connected: ["123456789012345"]), [])
        // 名前がまだ届いていない相手 (接続中...) の数だけ、残りから外す
        XCTAssertEqual(PochiEngine.missingNames(listed: ["A", "B"], connected: ["接続中..."]), ["B"])
        XCTAssertEqual(PochiEngine.missingNames(listed: [], connected: ["A"]), [])
    }
}
