// macOS 版の WebRTC には RTCAudioDevice の宣言が入っていない (iOS / Catalyst 版には入っている) ため、
// 同じ宣言をここで読み込む。実装は WebRTC 本体にあるはずなので、起動して確かめる。
#import <WebRTC/WebRTC.h>
#import "RTCAudioDevice.h"
