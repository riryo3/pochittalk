/**
 * worker.js - ぽちっと通話 (Cloudflare Workers 単一ファイル)
 * ダッシュボードの「コードを編集」に全文貼り付けて Deploy するだけで動きます。
 * 注意: 外側がテンプレートリテラルなので、内部の <script> ではバッククォートと ${} を使わないこと。
 */

const HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.png" type="image/png" sizes="96x96">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#1a1e24">
  <meta name="color-scheme" content="dark">
  <meta name="description" content="ボタンを押している間だけ話せる、トランシーバー風のグループ通話アプリ（α版）">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="ぽちっと通話">
  <meta property="og:title" content="ぽちっと通話 α版">
  <meta property="og:description" content="ボタンを押している間だけ話せる、トランシーバー風のグループ通話アプリ">
  <meta property="og:url" content="__ORIGIN__/">
  <meta property="og:image" content="__ORIGIN__/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="ぽちっと通話 α版">
  <meta name="twitter:description" content="ボタンを押している間だけ話せる、トランシーバー風のグループ通話アプリ">
  <meta name="twitter:image" content="__ORIGIN__/og.png">
  <title>ぽちっと通話 α版 - ボタンを押して話すトランシーバー</title>
  <style>
    html { background-color: #1a1e24; color-scheme: dark; }
    :root {
      --bg-color: #1a1e24;
      --card-bg: #252b36;
      --panel-bg: #14181d;
      --accent-color: #3b82f6;
      --tx-color: #ef4444;
      --rx-color: #10b981;
      --text-color: #f3f4f6;
      --muted-color: #9ca3af;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-color);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      min-height: 100dvh; /* iPhone の Safari では、100vh は、見える高さより大きく、中身が収まっていても、動いてしまう */
      padding: 16px;
    }
    .walkie-talkie {
      width: 100%;
      max-width: 400px;
      background: var(--card-bg);
      border-radius: 28px;
      padding: 24px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1);
      border: 2px solid #374151;
      display: flex;
      flex-direction: column;
      gap: 20px;
      position: relative;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #374151;
      padding-bottom: 12px;
    }
    .brand {
      font-weight: 800;
      letter-spacing: 1px;
      font-size: 1.1rem;
      color: #93c5fd;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .room-badge {
      font-size: 0.8rem;
      background: #1e293b;
      padding: 4px 10px;
      border-radius: 12px;
      color: var(--muted-color);
      border: 1px solid #334155;
          }
    .display {
      background: var(--panel-bg);
      border-radius: 16px;
      padding: 16px;
      border: 2px solid #22272e;
      box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .status-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 1.6rem; }
    .status-row .indicators { flex: none; }
    .indicators { display: flex; gap: 12px; }
    .led-wrapper { display: flex; align-items: center; gap: 4px; }
    .led {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #374151;
      transition: all 0.15s ease;
    }
    .led-label { font-size: 0.7rem; font-weight: 800; color: var(--muted-color); }
    .led.tx.active { background: var(--tx-color); box-shadow: 0 0 12px var(--tx-color); }
    .led.rx.active { background: var(--rx-color); box-shadow: 0 0 12px var(--rx-color); }
    .status-text { font-family: monospace; font-size: 1rem; font-weight: bold; color: #38bdf8; line-height: 1.6rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .peers-list {
      min-height: 24px;
      max-height: 110px;
      overflow-y: auto;
      font-size: 0.85rem;
      color: var(--muted-color);
      border-top: 1px dashed #2d3748;
      padding-top: 6px;
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      gap: 4px;
    }
    .peers-empty { opacity: 0.5; }
    .peer-tag {
      background: #1e293b;
      padding: 0 8px;
      line-height: 1.5;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.78rem;
    }
    .peer-tag.talking {
      background: #064e3b;
      color: #34d399;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.3);
    }
    .peer-tag.me { background: #172554; color: #bfdbfe; }
    .peer-tag.me.sending { background: #7f1d1d; color: #fecaca; box-shadow: 0 0 8px rgba(239, 68, 68, 0.35); }
    .ptt-container { display: flex; flex-direction: column; align-items: center; gap: 14px; margin: 6px 0; }
    .ptt-btn {
      width: 170px;
      height: 170px;
      border-radius: 50%;
      background: radial-gradient(circle, #3b82f6 0%, #1d4ed8 100%);
      border: 6px solid #1e3a8a;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4), inset 0 4px 6px rgba(255, 255, 255, 0.3);
      color: white;
      font-size: 1.25rem;
      font-weight: 800;
      letter-spacing: 1px;
      cursor: pointer;
      outline: none;
      transition: all 0.1s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      touch-action: none;
    }
    .ptt-btn:active, .ptt-btn.transmitting {
      transform: scale(0.96);
      background: radial-gradient(circle, #ef4444 0%, #b91c1c 100%);
      border-color: #7f1d1d;
      box-shadow: 0 0 25px rgba(239, 68, 68, 0.6), inset 0 2px 4px rgba(0, 0, 0, 0.4);
    }
    .ptt-main { font-size: 1.3rem; font-weight: 900; }
    .ptt-sub { font-size: 0.75rem; letter-spacing: 2px; opacity: 0.85; }
    .controls-info { text-align: center; font-size: 0.85rem; color: var(--muted-color); line-height: 1.5; }
    .key-badge {
      background: #374151;
      color: #f3f4f6;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.8rem;
      border-bottom: 2px solid #1f2937;
    }

    @media (hover: none) and (pointer: coarse), (max-width: 480px) {
      .pc-only { display: none; }
    }
    .alpha-badge { font-size: 0.65rem; font-weight: 800; color: #fbbf24; border: 1px solid #fbbf24; border-radius: 6px; padding: 1px 6px; letter-spacing: 1px; }
    .sticky-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 16px; background: rgba(20,24,29,0.95); border-bottom: 1px solid #374151; }
    .sticky-hash { font-family: "Courier New", monospace; font-weight: 800; color: #38bdf8; letter-spacing: 1px; }
    dialog { margin: auto; width: calc(100% - 32px); max-width: 460px; max-height: 85vh; padding: 0; border: 2px solid #374151; border-radius: 20px; background: var(--card-bg); color: var(--text-color); overflow: hidden; }
    dialog[open] { display: flex; flex-direction: column; }
    dialog::backdrop { background: rgba(0,0,0,0.65); }
    .about { display: flex; flex-direction: column; min-height: 0; max-height: 85vh; font-size: 0.85rem; line-height: 1.6; user-select: text; -webkit-user-select: text; }
    .about * { user-select: text; -webkit-user-select: text; }
    .about-head { flex: none; display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-bottom: 1px solid #374151; background: var(--card-bg); }
    .about-body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px 18px 20px; }
    .about a { color: #93c5fd; text-decoration: underline; }
    .about h3 { margin: 16px 0 6px; color: #93c5fd; font-size: 1rem; border-bottom: 1px solid #374151; padding-bottom: 4px; }
    .about h4 { margin: 12px 0 4px; color: #fbbf24; font-size: 0.88rem; }
    .about ul { padding-left: 1.2em; display: flex; flex-direction: column; gap: 4px; }
    .about p { color: var(--text-color); }
    .about b { color: #fff; }
    .vox-panel { display: flex; flex-direction: column; gap: 8px; }
    .vox-meter { position: relative; height: 10px; background: #111827; border-radius: 5px; overflow: hidden; border: 1px solid #374151; }
    .vox-fill { height: 100%; width: 0; background: var(--rx-color); transition: width .05s linear; }
    .vox-fill.over { background: var(--tx-color); }
    .vox-thr { position: absolute; top: 0; bottom: 0; width: 2px; background: #fbbf24; }
    .vox-sens { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--muted-color); }
    .vox-sens input { flex: 1; min-width: 0; height: 32px; margin: 0; touch-action: pan-y; }
    .vox-hint { font-size: 0.7rem; opacity: .8; white-space: nowrap; }
    .level-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-family: monospace; font-size: 0.65rem; color: var(--muted-color); }
    .level { flex: 1; height: 14px; min-width: 0; }
    .gain-val { min-width: 62px; text-align: right; font-family: monospace; }
    .level-label { min-width: 2.8em; }
    .level-db { width: 52px; text-align: right; }
    .ptt-wrap { position: relative; width: 100%; display: flex; justify-content: center; margin-bottom: 14px; } /* VOX が下にはみ出す分の余白 */
    /* VOX: 丸いボタン。話すボタンの左下に置く（左手用は右下） */
    .vox-btn {
      position: absolute; bottom: -14px; left: max(0px, calc(50% - 150px));
      width: 62px; height: 62px; border-radius: 50%;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
      background: #1f2937; color: var(--muted-color); border: 3px solid #374151;
      font-weight: 800; letter-spacing: 1px; cursor: pointer; outline: none; touch-action: manipulation;
      transition: all .15s ease;
    }
    .seg { display: flex; gap: 6px; }
    .seg-btn { flex: 1; padding: 8px 0; border-radius: 8px; border: 1px solid #374151; background: #1f2937; color: var(--muted-color); font-weight: 700; cursor: pointer; }
    .seg-btn.on { background: #1d4ed8; border-color: #3b82f6; color: #fff; }
    .ptt-wrap.pos-left { justify-content: flex-start; }
    .ptt-wrap.pos-right { justify-content: flex-end; }
    .ptt-wrap.pos-left .vox-btn { left: 173px; right: auto; }
    .ptt-wrap.pos-right .vox-btn { left: auto; right: 173px; }
    .ptt-wrap.lefty .vox-btn { left: auto; right: max(0px, calc(50% - 150px)); }
    .vox-btn-main { font-size: 0.85rem; line-height: 1; }
    .vox-btn-state { font-size: 0.62rem; line-height: 1; opacity: .85; }
    .vox-btn:active { transform: scale(0.95); }
    .vox-btn.on {
      background: radial-gradient(circle, #34d399 0%, #059669 100%);
      color: #052e1c; border-color: #065f46;
      box-shadow: 0 0 14px rgba(16, 185, 129, 0.65);
    }
    .invite-card { background: linear-gradient(180deg, #2a3243 0%, #232a36 100%); border: 2px solid #fbbf24; border-radius: 20px; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; box-shadow: 0 0 16px rgba(251,191,36,0.25); }
    .invite-title { color: #fbbf24; font-weight: 800; letter-spacing: 1px; font-size: 0.9rem; }
    .invite-hash { font-family: "Courier New", monospace; font-weight: 900; font-size: 2rem; color: #38bdf8; letter-spacing: 2px; text-shadow: 0 0 12px rgba(56,189,248,0.45); }
    .invite-info { font-size: 0.82rem; color: var(--muted-color); text-align: center; overflow-wrap: anywhere; min-height: 1.2em; }
    button.btn-sub.invite-join { width: 100%; background: #2563eb; padding: 12px 0; font-size: 1rem; }
    button.btn-sub.invite-join:hover { background: #1d4ed8; }
    .invite-links { display: flex; gap: 18px; }
    .linklike { background: none; border: none; color: #93c5fd; text-decoration: underline; font-size: 0.78rem; cursor: pointer; padding: 2px 4px; }
    .app-version { width: 100%; max-width: 400px; text-align: center; font-size: 0.7rem; color: var(--muted-color); opacity: .6; margin: 12px 0 4px; user-select: text; -webkit-user-select: text; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: #111827; color: #fff; border: 1px solid #fbbf24; border-radius: 12px; padding: 10px 16px; font-size: 0.85rem; z-index: 50; max-width: 90%; text-align: center; box-shadow: 0 6px 18px rgba(0,0,0,0.5); }
    /* 部屋を探すダイヤル（ラジオのチューニング風）。3部屋ぶんが見えて、上下に回し、赤い線に合わせた部屋をタップすると入る */
    .rdial-wrap { --rdial-row: 132px; position: relative; height: calc(var(--rdial-row) * 3); border-radius: 14px; background: #0f1419; border: 1px solid #2d3748; overflow: hidden; box-shadow: inset 0 2px 10px rgba(0,0,0,0.6); }
    .rdial { position: relative; z-index: 1; height: 100%; overflow-y: auto; padding: var(--rdial-row) 0; box-sizing: border-box; scroll-snap-type: y mandatory; scrollbar-width: none; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; outline: none; }
    .rdial::-webkit-scrollbar { display: none; }
    .rdial:focus-visible { box-shadow: inset 0 0 0 2px var(--accent-color); border-radius: 14px; }
    .rdial-item { height: var(--rdial-row); box-sizing: border-box; padding: 9px 16px 0; scroll-snap-align: center; scroll-snap-stop: always; display: flex; flex-direction: column; justify-content: flex-start; gap: 1px; cursor: pointer; color: var(--text-color); border-left: 3px solid transparent; will-change: transform, opacity; user-select: none; -webkit-user-select: none; }
    .rdial-item { position: relative; transform-origin: 50% 50%; background: none; }
    /* ドラム本体は動かない（背景は固定）。部屋の文字だけが、ドラムの面に印刷されて、回る */
    .rdial-wrap::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: var(--rdial-row); transform: translateY(-50%); pointer-events: none; z-index: 0; background: linear-gradient(180deg, rgba(148,163,184,0) 0%, rgba(148,163,184,0.07) 50%, rgba(148,163,184,0) 100%); }
    .rdial-item > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    /* 赤い線は、1行目（部屋の番号）と、2行目（タグや名前）の、すきまを通る */
    .rdial-item > div:nth-child(2) { margin-top: 12px; }
    .rdial-item .chip-tag, .rdial-item .chip-who { margin-top: 0; max-width: 100%; font-size: 0.74rem; }
    /* 在室の人は、全員の名前を出す（長くなったら、「、」の後で折り返す。省略しない） */
    .rdial-item > div.chip-who { white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.25; }
    .rdial-item.on-line { color: #fff; }
    /* 円柱の両端の、目盛りの溝。回すと流れ、上下に行くほど、間隔が詰まる */
    .rdial-rail { position: absolute; top: 0; bottom: 0; width: 13px; pointer-events: none; z-index: 3; }
    .rdial-rail.left { left: 0; background: linear-gradient(90deg, rgba(255,255,255,0.07), rgba(255,255,255,0)); }
    .rdial-rail.right { right: 0; background: linear-gradient(270deg, rgba(255,255,255,0.07), rgba(255,255,255,0)); }
    .rdial-ridges { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
    .rdial-ridge { position: absolute; left: 0; right: 0; top: 50%; height: 1px; margin-top: -0.5px; background: rgba(148,163,184,0.16); will-change: transform, opacity; }
    .rdial-tick { position: absolute; left: 2px; right: 2px; top: 50%; height: 2px; margin-top: -1px; border-radius: 1px; background: rgba(203,213,225,0.6); will-change: transform, opacity; }
    .rdial-item.me > div:first-child { color: #93c5fd; }
    .rdial-item.bot { border-left-color: #34d399; }
    .rdial-item.invited { border-left-color: #fbbf24; }
    .rdial-item.air { border-left-color: var(--tx-color); }
    .rdial-item.full { filter: grayscale(0.7); }
    .rdial-empty { height: var(--rdial-row); display: flex; align-items: center; justify-content: center; color: var(--muted-color); font-size: 0.82rem; text-align: center; padding: 0 16px; scroll-snap-align: center; }
    .rdial-line { position: absolute; left: 6px; right: 6px; top: 50%; height: 2px; transform: translateY(-1px); background: #ef4444; box-shadow: 0 0 8px #ef4444; pointer-events: none; border-radius: 1px; z-index: 0; }
    .rdial-line::before, .rdial-line::after { content: ''; position: absolute; top: -4px; border: 5px solid transparent; }
    .rdial-line::before { left: -2px; border-left-color: #ef4444; }
    .rdial-line::after { right: -2px; border-right-color: #ef4444; }
    .rdial-fade { position: absolute; left: 0; right: 0; height: 22%; pointer-events: none; z-index: 2; }
    .rdial-fade.top { top: 0; background: linear-gradient(180deg, rgba(15,20,25,.8) 0%, rgba(15,20,25,0) 100%); }
    .rdial-fade.bottom { bottom: 0; background: linear-gradient(0deg, rgba(15,20,25,.8) 0%, rgba(15,20,25,0) 100%); }
    .chan-chip.bot { border-color: #34d399; box-shadow: 0 0 8px rgba(52,211,153,0.35); }
    .chan-chip.full { opacity: .55; }
    .chan-chip.invited { border-color: #fbbf24; box-shadow: 0 0 8px rgba(251,191,36,0.35); }
    .tune-actions #qrBtn { flex: none; width: 64px; padding: 6px 0; line-height: 1; display: flex; align-items: center; justify-content: center; }
    .back-face {
      display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 4px 0 8px;
      background: linear-gradient(180deg, #232a36 0%, #1b212b 100%); border-radius: 18px; position: relative;
    }
    .back-face::before, .back-face::after {
      content: ''; position: absolute; top: 10px; width: 9px; height: 9px; border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #9ca3af, #4b5563 70%); box-shadow: 0 0 0 1px #111827;
    }
    .back-face::before { left: 6px; } .back-face::after { right: 6px; }
    .back-head { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 0 22px 8px; border-bottom: 2px solid #374151; color: #93c5fd; }
    .qr-sticker { background: #fff; border-radius: 14px; padding: 14px; width: 250px; max-width: 100%; box-shadow: 0 6px 16px rgba(0,0,0,0.45); transform: rotate(-1deg); }
    .qr-box { color: #374151; font-size: 0.8rem; text-align: center; min-height: 100px; display: flex; align-items: center; justify-content: center; }
    .qr-box svg { width: 100%; height: auto; display: block; }
    .back-room { font-family: "Courier New", monospace; font-weight: 800; font-size: 1.4rem; color: #38bdf8; letter-spacing: 2px; }
    .back-note { font-size: 0.8rem; color: var(--muted-color); text-align: center; }
    .back-url { font-size: 0.65rem; color: var(--muted-color); opacity: .75; word-break: break-all; text-align: center; padding: 0 20px; user-select: text; -webkit-user-select: text; }
    .tag-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.82rem; color: var(--muted-color); }
    .tag-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag-row .btn-sub { flex: none; white-space: nowrap; }
    .tag-text b { color: var(--text-color); }
    .tag-by { font-size: 0.72rem; margin-left: 4px; opacity: .8; }
    .tag-count { text-align: right; font-size: 0.72rem; color: var(--muted-color); margin-top: 4px; font-family: monospace; }
    .tag-count.full { color: #fbbf24; }
    .chip-tag { font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 0.78rem; color: #93c5fd; margin-top: 2px; overflow-wrap: anywhere; max-width: 260px; }
    .tune-actions #speakerBtn { flex: none; width: 64px; font-size: 1.15rem; padding: 6px 0; line-height: 1; white-space: nowrap; }
    #speakerBtn.muted { background: #7f1d1d; color: #fecaca; }
    .hidden { display: none !important; }
    .home { width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 16px; }
    .lcd { text-align: center; padding: 4px 0 2px; }
    .lcd-ch { font-family: monospace; font-size: 0.8rem; color: var(--muted-color); letter-spacing: 3px; }
    .lcd-freq { font-family: "Courier New", monospace; font-size: 2.3rem; font-weight: 900; color: #38bdf8; text-shadow: 0 0 14px rgba(56,189,248,0.55); letter-spacing: 2px; line-height: 1.1; transition: opacity .1s; }
    .lcd-freq small { font-size: 0.9rem; letter-spacing: 1px; margin-left: 6px; opacity: .8; }
    .lcd-freq.tuning { opacity: .45; animation: blink .35s steps(2) infinite; }
    @keyframes blink { 50% { opacity: .9; } }
    .lcd-sub { font-size: 0.72rem; color: var(--muted-color); min-height: 1em; white-space: nowrap; overflow: hidden; }
    .fax-paper { width: 100%; image-rendering: pixelated; background: #f8f8f2; border-radius: 4px; display: block; margin-top: 6px; }
    .tuner { display: flex; flex-direction: column; gap: 10px; }
    .dial-row { display: flex; align-items: center; gap: 8px; }
    .step-btn { width: 40px; height: 40px; border-radius: 10px; border: none; background: #374151; color: #fff; font-size: 1rem; cursor: pointer; flex: none; }
    .step-btn:active { background: #4b5563; transform: scale(.94); }
    .dial { flex: 1; position: relative; height: 40px; border-radius: 8px; background: #0f1419; border: 1px solid #2d3748;
      background-image: repeating-linear-gradient(90deg, #4b5563 0 1px, transparent 1px 10px), repeating-linear-gradient(90deg, #9ca3af 0 2px, transparent 2px 50px);
      background-size: 100% 40%, 100% 70%; background-repeat: no-repeat; background-position: 0 100%, 0 100%; }
    .dial input[type=range] { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; background: transparent; -webkit-appearance: none; appearance: none; touch-action: pan-y; cursor: ew-resize; }
    .dial input[type=range]::-webkit-slider-runnable-track { background: transparent; height: 40px; }
    .dial input[type=range]::-moz-range-track { background: transparent; height: 40px; }
    .dial input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 6px; height: 40px; background: #ef4444; border-radius: 3px; box-shadow: 0 0 8px #ef4444; }
    .dial input[type=range]::-moz-range-thumb { width: 6px; height: 40px; background: #ef4444; border: none; border-radius: 3px; box-shadow: 0 0 8px #ef4444; }
    .tune-actions { display: flex; gap: 8px; }
    .tune-actions button { flex: 1; font-size: 0.8rem; padding: 8px 6px; }
    .scan-title { font-size: 0.72rem; color: var(--muted-color); letter-spacing: 1px; display: flex; justify-content: space-between; }
    .scan-list { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; }
    .chan-chip { background: #1e293b; border: 1px solid #334155; color: var(--text-color); border-radius: 8px; padding: 4px 8px; font-size: 0.78rem; cursor: pointer; font-family: monospace; }
    .chan-chip.me { border-color: var(--accent-color); background: #172554; }
    .chan-chip.air { border-color: var(--tx-color); box-shadow: 0 0 8px rgba(239,68,68,.5); }
    .room-panel { width: 100%; max-width: 400px; margin-top: 16px; background: var(--card-bg); border: 2px solid #374151; border-radius: 20px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .chan-chip { text-align: left; }
    .chip-who { font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 0.72rem; color: var(--muted-color); margin-top: 2px; max-width: 220px; }
    .chip-name { display: inline-block; } /* 名前の途中では改行しない（区切りの「、」の後でのみ折る） */
    .scan-list { flex-direction: column; }
    .chan-chip:active { transform: scale(.96); }
    .config-panel { display: flex; flex-direction: column; gap: 10px; font-size: 0.85rem; }
    .input-row { display: flex; gap: 8px; }
    input[type="text"] {
      flex: 1;
      min-width: 0;
      background: #111827;
      border: 1px solid #374151;
      color: white;
      padding: 8px 12px;
      border-radius: 8px;
      outline: none;
      font-size: 16px;
      user-select: text;
      -webkit-user-select: text;
    }
    input[type="text"]:focus { border-color: var(--accent-color); }
    button.btn-sub {
      background: #374151;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
    }
    button.btn-sub:hover { background: #4b5563; }
    .sound-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--muted-color); font-size: 0.8rem; }
    /* 通信の診断パネル: 広い画面では右側に固定して、操作画面と重ならないようにする。狭い画面では、下に出して、操作画面は、その分だけ、上へスクロールできる */
    #diagPanel { display: none; position: fixed; left: 8px; right: 8px; bottom: 8px; max-height: 36vh; overflow: auto; z-index: 50; padding: 8px 10px; border-radius: 10px; background: rgba(2,6,23,.96); border: 1px solid #334155; font-size: 0.72rem; line-height: 1.55; word-break: break-all; }
    #diagPanel.on { display: block; }
    body.diag-on { padding-bottom: 40vh; }
    @media (min-width: 900px) {
      #diagPanel { left: auto; top: 0; right: 0; bottom: 0; width: 400px; max-height: none; border-radius: 0; border-width: 0 0 0 1px; }
      body.diag-on { padding-bottom: 16px; padding-right: 416px; }
    }
    #reconnectBtn:disabled { opacity: .45; cursor: wait; }

    /* スマホ（幅700px以下）: ダイヤルは、左端のドロワーに入れる。画面の左端の帯が、ドロワーを開くボタン */
    .dial-tab, .dial-scrim { display: none; }
    .dial-tab-close { display: none; }
    .dial-detail { display: none; }
    @media (max-width: 700px) {
      body { padding-left: 28px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px; justify-content: flex-start; }
      /* スマホは、縦に詰めて、スクロールをなるべく無くす */
      .walkie-talkie { padding: 14px 14px; gap: 10px; }
      .controls-info { display: none; }
      .ptt-container { gap: 6px; margin: 0; }
      .ptt-wrap { margin-bottom: 18px; } /* VOXボタンが、下にはみ出す分 + 12px */
      .ptt-btn { width: 150px; height: 150px; }
      .display { gap: 8px; }
      .header .brand { font-size: 0.95rem; white-space: nowrap; gap: 4px; }
      .header .brand span { white-space: nowrap; }
      .header .alpha-badge { font-size: 0.6rem; padding: 1px 5px; }
      .header .btn-sub { padding: 4px 8px !important; white-space: nowrap; font-size: 0.78rem; }
      /* 左端の全体が、押せる範囲（見えない）。見えるのは、端から出ている、丸みのあるタブだけ */
      .dial-tab { display: flex; position: fixed; left: 0; top: 0; bottom: 0; width: 38px; z-index: 45; align-items: center; justify-content: flex-start; border: 0; background: transparent; padding: 0; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
      .dial-tab-body { writing-mode: vertical-rl; display: flex; align-items: center; justify-content: center; height: min(430px, 78vh); padding: 0 7px; background: #1f2937; border: 1px solid #374151; border-left: 0; border-radius: 0 14px 14px 0; box-shadow: 2px 0 8px rgba(0,0,0,.45); color: #cbd5e1; font-size: 0.85rem; font-weight: 700; letter-spacing: 3px; }
      .dial-tab:active .dial-tab-body { background: #374151; }
      .dial-tab.dial-tab-close { display: none; }
      #dialCard { position: fixed; left: 0; top: 0; bottom: 0; width: min(88vw, 400px); max-width: none; margin: 0 !important; z-index: 60; overflow-y: auto; border-radius: 0 20px 20px 0; transform: translateX(-105%); transition: transform .25s ease; }
      body.dial-open #dialCard { transform: none; }
      /* ドロワーを開いている間は、その右端に、「閉じる」タブが出る */
      body.dial-open .dial-tab.dial-tab-close { display: flex; left: min(88vw, 400px); z-index: 61; width: 40px; pointer-events: none; }
      body.dial-open .dial-tab-close .dial-tab-body { pointer-events: auto; }
      body.dial-open .dial-tab:not(.dial-tab-close) { display: none; }
      /* ドロワーの下の空きに、赤い線に合わせた部屋の詳しい情報と、入るボタンを出す */
      .dial-detail { display: flex; flex-direction: column; gap: 8px; padding: 12px 4px 4px; border-top: 1px solid #374151; margin-top: 4px; }
      .dial-detail .dd-title { font-family: monospace; font-size: 1.15rem; font-weight: 800; color: #93c5fd; letter-spacing: 1px; }
      .dial-detail .dd-tag { font-size: 0.85rem; color: #93c5fd; }
      .dial-detail .dd-count { font-size: 0.8rem; color: var(--muted-color); }
      .dial-detail .dd-names { display: flex; flex-wrap: wrap; gap: 6px; }
      .dial-detail .dd-names span { background: #1f2937; border: 1px solid #374151; border-radius: 999px; padding: 3px 10px; font-size: 0.82rem; }
      .dial-detail button { margin-top: 6px; }
      .dial-scrim { position: fixed; inset: 0; z-index: 55; background: rgba(0,0,0,.5); }
      body.dial-open .dial-scrim { display: block; }
      .morse-drawer { left: 0; }
    }

    /* 広い画面: 左に本体、右にダイヤル。ダイヤルの下に、操作ボタンの別カード */
    body.wide { display: grid; grid-template-columns: repeat(2, minmax(0, 400px)); grid-template-rows: auto auto auto auto; column-gap: 24px; justify-content: center; align-content: start; align-items: start; }
    body.wide > #homeView { grid-column: 1 / -1; grid-row: 1; width: 100%; max-width: 400px; justify-self: center; }
    body.wide > #radioView { grid-column: 1; grid-row: 2 / span 2; align-self: start; }
    body.wide > #dialCard { grid-column: 2; grid-row: 2; margin-top: 0 !important; }
    body.wide > #homeCard, body.wide > #ctrlCard { grid-column: 2; grid-row: 3; align-self: end; }
    body.wide > .app-version { grid-column: 1 / -1; grid-row: 4; }
    #ctrlCard { width: 100%; max-width: 400px; margin-top: 16px; background: var(--card-bg); border: 2px solid #374151; border-radius: 20px; padding: 16px; display: none; flex-direction: column; gap: 10px; }
    body.wide #ctrlCard:not(.hidden) { display: flex; }
    #ctrlCard .ctrl-row { display: flex; gap: 8px; }
    #ctrlCard .ctrl-row button { flex: 1; font-size: 0.8rem; padding: 8px 6px; }
    #ctrlCard #qrBtn, #ctrlCard #speakerBtn { flex: none; width: 64px; padding: 6px 0; line-height: 1; display: flex; align-items: center; justify-content: center; }
    .tune-actions:empty { display: none; }
    /* 招待URLで開いたとき: 本体に、その部屋の情報を出し、PTTボタンが「入室」ボタンになる */
    .walkie-talkie.invite { opacity: 1; filter: none; pointer-events: none; }
    .walkie-talkie.invite .ptt-btn, .walkie-talkie.invite .invite-links, .walkie-talkie.invite .invite-links * { pointer-events: auto; }
    .walkie-talkie.invite #tagEdit { visibility: hidden; }
    .walkie-talkie.invite .header button, .walkie-talkie.invite #tuneBar, .walkie-talkie.invite .vox-btn { opacity: .4; }
    #tuneBar:has(.tune-actions:empty) { display: none; }
    /* トップページでは、本体は表示するだけ（操作はできない） */
    .walkie-talkie.idle { pointer-events: none; }
    .walkie-talkie.idle .header, .walkie-talkie.idle .display, .walkie-talkie.idle .vox-btn, .walkie-talkie.idle .controls-info, .walkie-talkie.idle #tuneBar { opacity: .42; filter: grayscale(.7); }
    .walkie-talkie.idle .ptt-btn { pointer-events: auto; }
    #emptyBtn { display: none; }
    #nameBox input { width: 100%; box-sizing: border-box; }
    body.wide #homeCard { padding: 10px 16px; gap: 4px; }
    body.wide #homeCard #settingsBtn { padding: 4px 8px; }
    body.wide #homeCard #nameInput { padding-top: 5px; padding-bottom: 5px; }
    body.wide #homeCard .field-label { line-height: 1.1; margin-bottom: 2px; }
    .field-label { display: block; font-size: 0.72rem; color: var(--muted-color); margin: 0 0 4px 2px; }
    #idleSlot { display: none; flex-direction: column; gap: 10px; pointer-events: auto; }
    .walkie-talkie.slot-on #tuneBar { display: none; }
    .walkie-talkie.slot-on #idleSlot { display: flex; }
    #homeCard:not(:has(#nameInput)) { display: none; }
    .morse-toggle { flex: none; padding: 5px 14px; border-radius: 999px; background: #374151; border: 1px solid #4b5563; color: #e5e7eb; font-weight: 700; font-size: 0.85rem; }
    #settingsBtn { background: #334155; border: 1px solid #64748b; color: #f1f5f9; font-weight: 700; }
    #settingsBtn:hover { background: #475569; }
    #frontFace .config-panel:not(:has(.vox-panel:not(.hidden))) { display: none; }
    /* スマホ: 画面下のドロワーに、QWERTYのモールスキーボード（スペースなし）。PTTボタンに、かぶってよい */
    .morse-drawer { display: none; position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; background: #252b36; border-top: 1px solid #374151; border-radius: 14px 14px 0 0; box-shadow: 0 -6px 20px rgba(0,0,0,.5); padding-bottom: env(safe-area-inset-bottom); }
    .morse-handle { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; background: none; border: 0; border-bottom: 1px solid #1f2937; color: var(--text-color); font-size: 0.9rem; cursor: pointer; gap: 8px; }
    .morse-queue { font-family: monospace; color: #38bdf8; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .morse-body { display: none; padding: 2px 6px 12px; }
    .morse-drawer.open .morse-body { display: block; }
    .mk-row { display: flex; gap: 4px; justify-content: center; margin: 4px 0; }
    .mk { flex: 1; max-width: 38px; height: 42px; border-radius: 8px; background: #1f2937; color: #e5e7eb; border: 1px solid #374151; font-size: 1rem; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
    .mk:active { background: #2563eb; }
    .mk.wide { max-width: 64px; flex: 1.7; font-size: 0.8rem; }
    @media (hover: none) and (pointer: coarse), (max-width: 480px) { .morse-drawer:not(.hidden) { display: block; } }
  </style>
</head>
<body>
  <div class="home" id="homeView">
    <section class="invite-card hidden" id="inviteCard">
      <div class="invite-title">招待された部屋</div>
      <div class="invite-hash" id="inviteHash">----·----</div>
      <div class="invite-info" id="inviteInfo"></div>
      <button class="btn-sub invite-join" id="inviteJoin" type="button">この部屋に入る</button>
      <div class="invite-links">
        <button class="linklike" id="inviteLater" type="button">あとで</button>
        <button class="linklike" id="inviteAbout" type="button">使い方・プライバシー</button>
      </div>
    </section>
  </div>

  <div class="sticky-bar hidden" id="stickyBar">
    <span class="sticky-hash" id="roomDisplay">----·----</span>
    <button class="btn-sub" id="leaveBtn2" type="button" style="padding:4px 10px">退出</button>
  </div>

  <main class="walkie-talkie idle" id="radioView">
    <div id="frontFace">
    <header class="header">
      <div class="brand"><span>🔘</span><span>ぽちっと通話</span><span class="alpha-badge">α版</span></div>
      <div id="headerBtns" style="display:flex;gap:6px;align-items:center">
        <button class="btn-sub" id="reconnectBtn" type="button" style="padding:4px 10px">再接続</button>
        <button class="btn-sub" id="leaveBtn" type="button" style="padding:4px 10px">退出</button>
      </div>
    </header>
    <section class="display">
      <div class="lcd">
        <div class="lcd-ch" id="chDisplay">ROOM HASH</div>
        <div class="lcd-freq" id="freqDisplay">----·----</div>
        <div class="lcd-sub" id="lcdSub"></div>
        <div class="level-row"><span class="level-label" id="levelLabel">LEVEL</span><canvas class="level" id="levelCanvas" width="280" height="14"></canvas><span class="level-db" id="levelDb">-∞ dB</span></div>
      </div>
      <canvas id="faxCanvas" width="240" height="15" class="fax-paper hidden"></canvas>
      <div class="tag-row">
        <span class="tag-text" id="tagText"></span>
        <button class="btn-sub" id="tagEdit" type="button" style="padding:4px 10px;font-size:0.75rem">つける</button>
      </div>
      <div class="hidden" id="tagForm">
        <div class="input-row">
          <input type="text" id="tagInput" maxlength="30" placeholder="いまの話題（例：ゲームの話）" autocomplete="off">
          <button class="btn-sub" id="tagSend" type="button">確定</button>
        </div>
        <div class="tag-count"><span id="tagCount">0</span> / 30 文字</div>
      </div>
      <div class="status-row">
        <div class="indicators">
          <div class="led-wrapper"><span class="led tx" id="ledTx"></span><span class="led-label">TX</span></div>
          <div class="led-wrapper"><span class="led rx" id="ledRx"></span><span class="led-label">RX</span></div>
        </div>
        <div class="status-text" id="statusLabel">STANDBY</div>
      </div>
      <div class="peers-list" id="peersList"><span class="peers-empty">待機中（参加者なし）</span></div>
      <div id="peerCount" style="text-align:right;font-size:0.72rem;opacity:.9;margin-top:2px;line-height:1.4;min-height:1.4em"></div>
    </section>
    <section class="ptt-container">
      <div class="ptt-wrap">
        <button class="ptt-btn" id="pttBtn" type="button">
          <span class="ptt-main">NEW</span>
          <span class="ptt-sub">新しい部屋</span>
        </button>
        <button class="vox-btn" id="voxBtn" type="button" aria-pressed="false" title="VOX（声を拾って自動で送信）">
          <span class="vox-btn-main">VOX</span>
          <span class="vox-btn-state" id="voxState">OFF</span>
        </button>
      </div>
      <div class="controls-info">
        <span class="pc-only"><kbd class="key-badge">スペース</kbd> キーで PTT</span>
        <br><span class="pc-only">キータイプでモールス</span>
      </div>
      <div class="invite-links hidden" id="inviteLinks" style="justify-content:center;flex-wrap:wrap;gap:6px 14px;margin-top:6px">
        <button class="linklike" id="inviteLater2" type="button">あとで</button>
        <button class="linklike" id="inviteNew2" type="button">新しい部屋を作る</button>
        <button class="linklike" id="inviteAbout2" type="button">使い方・プライバシー</button>
      </div>
    </section>
    <footer class="config-panel">
      <div class="vox-panel hidden" id="voxPanel">
        <div class="vox-meter"><div class="vox-fill" id="voxFill"></div><div class="vox-thr" id="voxThr"></div></div>
        <label class="vox-sens"><span>しきい値</span><input type="range" id="voxSens" min="1" max="10" step="1" value="6"></label>
      </div>
    </footer>
    </div>
    <div class="back-face hidden" id="backFace">
      <div class="back-head">
        <strong>招待 QR</strong>
      </div>
      <div class="qr-sticker"><div class="qr-box" id="qrBox">読み込み中…</div></div>
      <div class="back-room" id="qrRoom">----·----</div>
      <p class="back-note">このコードを読み取ると、同じ部屋に入れます。</p>
      <div class="back-url" id="qrUrl"></div>
    </div>
    <footer class="config-panel" id="tuneBar">
      <div class="tune-actions" id="tuneActions">
        <button class="btn-sub" id="shareBtn" type="button">招待URLをコピー</button>
        <button class="btn-sub" id="qrBtn" type="button" title="QRコードで招待" aria-label="QRコードで招待"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM18 18h3v3h-3z" fill="currentColor" stroke="none"/></svg></button>
        <button class="btn-sub" id="speakerBtn" type="button" title="スピーカーのミュート切り替え" aria-label="スピーカーのミュート切り替え">🔈</button>
      </div>
    </footer>
    <div id="idleSlot"></div>
  </main>

  <section class="room-panel" id="dialCard" style="margin-top:16px">
      <div class="scan-title"><span>いまある部屋（赤い線でタップ）</span><span id="onlineCount" style="white-space:nowrap"></span></div>
      <input type="text" id="searchInput" placeholder="🔍 URL・ハッシュ・名前・話題で絞り込み" autocomplete="off" style="width:100%;flex:none">
      <div class="rdial-wrap" id="dialWrap">
        <div class="rdial-ridges" id="ridges" aria-hidden="true"></div>
        <div class="rdial-line" aria-hidden="true"></div>
        <div class="rdial" id="scanList" tabindex="0" role="listbox" aria-label="部屋を選ぶダイヤル。上下に回して、赤い線に合わせた部屋をタップすると入ります"><div class="rdial-empty">スキャン中...</div></div>
        <div class="rdial-rail left" id="railL"></div><div class="rdial-rail right" id="railR"></div>
        <div class="rdial-fade top"></div><div class="rdial-fade bottom"></div>
      </div>
      <div class="dial-detail" id="dialDetail"></div>
  </section>

    <section class="room-panel" id="homeCard" style="margin-top:16px">
      <div id="nameBox"><label class="field-label" for="nameInput">ハンドルネーム（みんなに見える、あなたの名前）</label>
      <input type="text" id="nameInput" placeholder="ハンドルネーム" maxlength="12" autocomplete="off"></div>
      <button class="btn-sub" id="emptyBtn" type="button">新しい部屋を作る</button>
      <button class="btn-sub" id="settingsBtn" type="button">⚙ 設定（マイク・このアプリについて）</button>
    </section>

  <section id="ctrlCard" class="hidden" aria-label="操作ボタン">
    <div class="ctrl-row" id="ctrlRow1"></div>
    <div class="ctrl-row" id="ctrlRow2"></div>
  </section>

  <div class="morse-drawer hidden" id="morseDrawer">
    <button class="morse-handle" id="morseHandle" type="button" aria-expanded="false"><span>⌨ モールスで送る</span><span class="morse-queue" id="morseQueueView"></span><span class="morse-toggle" id="morseToggle">▲ 開く</span></button>
    <div class="morse-body" id="morseBody"></div>
  </div>

  <button class="dial-tab" id="dialTab" type="button" aria-label="部屋を探す（ダイヤルを開く）" aria-expanded="false"><span class="dial-tab-body">部屋を探す ▶</span></button>
  <button class="dial-tab dial-tab-close" id="dialCloseTab" type="button" aria-label="ダイヤルを閉じる"><span class="dial-tab-body">◀ 閉じる</span></button>
  <div class="dial-scrim" id="dialScrim"></div>

  <div class="app-version" id="appVersion">版 __VERSION__</div>

  <div class="toast hidden" id="toast" role="status"></div>

  <div id="diagPanel">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><strong>通信の診断</strong><span><button class="btn-sub" id="diagCopy" type="button" style="padding:2px 12px;margin-right:6px">コピー</button><button class="btn-sub" id="diagClose" type="button" style="padding:2px 12px">閉じる</button></span></div>
    <div id="diagBox"></div>
  </div>
  <dialog id="settingsDialog">
    <div class="about">
      <div class="about-head">
        <strong>設定</strong>
        <button class="btn-sub" id="settingsClose" type="button" style="padding:4px 12px">閉じる</button>
      </div>
      <div class="about-body">
        <h3>マイク</h3>
        <p>「マイクテスト開始」を押して声を出し、メーターが振れることを確認してください。小さく聞こえる場合は、入力レベルを上げます（上げすぎると音が割れます）。</p>
        <label class="vox-sens" style="margin:10px 0"><span>入力レベル</span><input type="range" id="homeGain" min="0" max="30" step="1" value="0"><span class="gain-val" id="homeGainVal">そのまま</span></label>
        <div class="level-row"><span class="level-label">MIC</span><canvas class="level" id="homeLevelCanvas" width="280" height="14"></canvas><span class="level-db" id="homeLevelDb">-∞ dB</span></div>
        <button class="btn-sub" id="micTestBtn" type="button" style="width:100%;margin-top:10px">マイクテスト開始</button>
        <h3>操作</h3>
        <p style="margin:8px 0 6px">話すボタンの位置</p>
        <div class="seg" id="pttPosSeg">
          <button type="button" class="seg-btn" data-pos="left">左</button>
          <button type="button" class="seg-btn on" data-pos="center">中央</button>
          <button type="button" class="seg-btn" data-pos="right">右</button>
        </div>
        <p style="opacity:.8;font-size:0.75rem;margin:6px 0 10px">片手で持つときに、親指が届く側に寄せられます。VOX の丸ボタンは、空いている側に付きます。</p>
        <label class="sound-toggle"><input type="checkbox" id="leftyCheck"> 左手用（話すボタンが中央のとき、VOX ボタンを右側に置く）</label>
        <h3>通話テスト</h3>
        <p style="font-size:0.8rem;opacity:.85;margin-bottom:6px">おうむ返しボットが動いているときだけ使えます。話すと、あなたの声が返ってきます。</p>
        <button class="btn-sub" id="testRoomBtn" type="button" style="width:100%">おうむ返しの部屋に入る</button>
        <h3>効果音</h3>
        <label class="vox-sens" style="margin:10px 0"><span>音量</span><input type="range" id="sfxVol" min="0" max="150" step="5" value="100"><span class="gain-val" id="sfxVolVal">100%</span></label>
        <p style="opacity:.8;font-size:0.75rem">スライダーを離すと、試しに「ガッ」と鳴ります。効果音を消したいときは、音量を 0% にしてください。</p>
        <h3>通信の診断</h3>
        <p style="font-size:0.8rem;opacity:.85;margin-bottom:6px">うまくつながらないときに使います。ボタンを押すと、設定が閉じて、メイン画面の下に診断が出ます。部屋に入ったまま、相手ごとの接続の状態を見られます。画面を撮って送ると、原因を調べやすくなります。</p>
        <button class="btn-sub" id="diagBtn" type="button" style="width:100%">診断を、メイン画面に表示する</button>
        <label class="sound-toggle" style="margin-top:8px"><input type="checkbox" id="diagAlways"> 診断を、常に表示する（広い画面では右側、狭い画面では下）</label>
        <label class="sound-toggle" style="margin-top:8px"><input type="checkbox" id="autoReconnect"> 自動で再接続する（標準はオフ。画面に戻ったときや、回線が戻ったときなど）</label>
        <label class="sound-toggle" style="margin-top:8px"><input type="checkbox" id="relayOnly"> 通信を、中継（TURN）経由のみにする（標準はオン。直接つなぎたいときだけ、オフ）</label>
        <p style="opacity:.8;font-size:0.75rem">切り替えると、ページを読み込み直します。部屋のみんなが同じ設定である必要はありません。</p>
        <h3>初回案内</h3>
        <label class="sound-toggle"><input type="checkbox" id="welcomeAgain2"> 開いたときに初回案内を表示する</label>
        <h3>ソース・ライセンス</h3>
        <p>このアプリは、qramo さんの「ぽっと通話」をもとに、ボタンを押している間だけ話せるようにしたものです。</p>
        <p><a href="https://potalk.app/" target="_blank" rel="noopener noreferrer">potalk.app</a><br><a href="https://github.com/qramo/po_call" target="_blank" rel="noopener noreferrer">github.com/qramo/po_call</a></p>
        <p>このアプリのソースコードは GitHub で公開しています。<br><a href="https://github.com/riryo3/pochittalk" target="_blank" rel="noopener noreferrer">github.com/riryo3/pochittalk</a></p>
        <p>MIT License<br>Copyright (c) 2026 qramo<br>Copyright (c) 2026 リョータ</p>
        <p style="opacity:.8;font-size:0.75rem">使用ライブラリ: <a href="https://github.com/dmotz/trystero" target="_blank" rel="noopener noreferrer">Trystero</a>（MIT License）</p>
        <h3>このアプリについて</h3>
        <button class="btn-sub" id="aboutBtn" type="button" style="width:100%">使い方・プライバシーを見る</button>
        <p style="opacity:.55;font-size:0.7rem;margin-top:10px">版: __VERSION__</p>
      </div>
    </div>
  </dialog>

  <dialog id="welcomeDialog">
    <div class="about">
      <div class="about-head">
        <strong>ようこそ <span class="alpha-badge">α版</span></strong>
      </div>
      <div class="about-body">
        <p style="margin-top:8px">はじめにご確認ください。</p>
        <h3>1. マイクを設定する</h3>
        <p>声が相手に十分な大きさで届くよう、入力レベルを調整できます。</p>
        <button class="btn-sub" id="welcomeMicBtn" type="button" style="width:100%;margin-top:6px">マイクを設定する</button>
        <h3>2. このアプリについて読む</h3>
        <p>使い方と、プライバシー（見える情報、保存されるもの）を説明しています。</p>
        <button class="btn-sub" id="welcomeAboutBtn" type="button" style="width:100%;margin-top:6px">このアプリについて</button>
        <label class="sound-toggle" style="margin-top:16px"><input type="checkbox" id="welcomeAgain" checked> 次回も表示する</label>
        <button class="btn-sub" id="welcomeClose" type="button" style="width:100%;margin-top:12px;background:#2563eb">はじめる</button>
      </div>
    </div>
  </dialog>

  <dialog id="aboutDialog">
    <div class="about">
      <div class="about-head">
        <strong>ぽちっと通話 <span class="alpha-badge">α版</span></strong>
        <button class="btn-sub" id="aboutClose" type="button" style="padding:4px 12px">閉じる</button>
      </div>
      <div class="about-body">

      <h3>このアプリは？</h3>
      <p>ボタンを押している間だけ話せる、トランシーバー風の音声通話アプリです。アカウント登録やログインは要りません。同じ部屋に入った人どうしで話せます。α版のため、予告なく仕様が変わったり、動作が不安定だったりすることがあります。</p>

      <h3>使い方</h3>
      <ul>
        <li>ハンドルネームを決めて、「新しい部屋を作る」か、一覧の部屋をタップして入ります。</li>
        <li>入室後は、大きなボタンを押している間だけ話せます（PCではスペースキーも使えます）。</li>
        <li>「招待URLをコピー」で友達にURLを送ると、同じ部屋に入れます。</li>
        <li>誰かが話している間は話せません（話中）。同時に押すと混線して、どちらも送信が切れます。</li>
        <li>部屋の中のQRボタンを押すと、無線機が裏返って、招待URLのQRコードが出ます。友達がスマホで読み取ると、同じ部屋に入れます。「もどる」で表に戻ります。</li>
        <li>部屋の中では、「話題タグ」をつけられます（30文字まで）。誰でも変えられ、付けた人の名前が添えられます。部屋の一覧にも表示されます。</li>
        <li>相手が見つからない、声が届かなくなったときは、「再接続」を押すと、部屋に入ったまま接続をやり直します。自動でやり直したいときは、設定の「自動で再接続する」をオンにします（標準はオフ）。iPhone は、画面を消したりほかのアプリに切り替えたりすると通話が止まるので、アプリに戻ってください。</li>
        <li>部屋の一覧の人数と、実際につながっている人数が、10秒以上合わないときは、画面に知らせが出ます。自動で再接続をオンにしていれば、25秒たっても合わないときに、つなぎ直します。相手が、ブラウザを突然閉じたときは、一覧の表示が、20秒ほど残ります。それでも合わないときは、「再接続」を押してください。</li>
        <li>1つの部屋は、8人までです。満員の部屋には、入れません。同時に入って超えたときは、あとから入った人が、自動で退出します。</li>
      </ul>

      <h3>プライバシー</h3>
      <h4>誰に何が見えるか</h4>
      <ul>
        <li><b>ハンドルネーム・今いる部屋・話し中かどうか</b>は、このアプリを同時に開いている全員に見えます（部屋一覧のため）。本名や個人が特定できる名前は使わないでください。</li>
        <li><b>話題タグ</b>と、付けた人のハンドルネームも、一覧で全員に見えます。個人情報は書かないでください。</li>
        <li><b>部屋は公開です。</b>部屋のハッシュ値は一覧に出るので、誰でもタップして入れます。秘密の話をする用途には向いていません。</li>
        <li><b>同じ部屋の人には、あなたのIPアドレスが見える</b>ことがあります。通話が端末どうしの直接通信（P2P）で行われるためです。</li>
        <li>同じ部屋の誰かが、自分の端末で通話を録音する可能性はあります。このアプリには防ぐ仕組みはありません。</li>
      </ul>

      <h4>音声について</h4>
      <ul>
        <li>音声は、通常、端末どうしで直接送られます。直接つながれない場合だけ、CloudflareのTURNサーバーを中継して送られます。通信はWebRTCの標準の暗号化がかかるため、中継サーバーが内容を聞くことはできません。TURNが使えないときは、端末どうしの直接通信に切り替わります。</li>
        <li>このアプリの運営側は、音声を受け取らず、録音も保存もしません（そもそも運営側のサーバーに届きません）。</li>
        <li>VOX（声で自動送信）をオンにすると、声を検出するために端末の中でマイクの音量を監視します。この監視用の音は送信も保存もされず、声を検出したときだけ送信が始まります。同じ理由で、マイクが使える状態の間は、画面のレベル表示のためにも端末の中で音量を測っています。ホーム画面の「マイクテスト」は、入力レベルとメーターの確認のためにマイクを使いますが、音声は送信も保存もされません。VOX自体は、ページを開き直すとオフに戻ります（しきい値の設定だけ、端末に保存されます）。</li>
        <li>マイクは、部屋に入るときに許可を求めます（許可しなかった場合は、話すボタンを押したときにもう一度確認します）。許可後は、部屋に入っている間マイクを確保しますが、ボタンを押していない間は音声を送りません（ブラウザのマイク使用中の表示は出たままになります）。部屋を退出すると、マイクを解放します。</li>
      </ul>

      <h4>あなたの端末に保存されるもの</h4>
      <ul>
        <li><b>ハンドルネーム</b>: ブラウザの localStorage（キー名 pochitalk_ptt_name）に保存されます。次回開いたときに入力済みになります。この端末のブラウザの中だけにあり、運営側には送られません。ブラウザのサイトデータを消すと削除されます。</li>
        <li><b>URLの「?r=…」</b>: 今いる部屋のハッシュ値がアドレスに入ります。ブラウザの履歴に残ることがあります。</li>
        <li><b>初回案内の表示設定</b>: 初回の案内で「次回も表示する」をオフにしたときだけ、その旨を localStorage（キー名 pochitalk_welcome）に保存します。この端末のブラウザの中だけにあり、運営側には送られません。</li>
        <li><b>話すボタンの位置</b>: 左または右にしたときだけ、その旨を localStorage（キー名 pochitalk_ptt_pos）に保存します。この端末のブラウザの中だけにあり、運営側には送られません。</li>
        <li><b>左手用の設定</b>: ONにしたときだけ、その旨を localStorage（キー名 pochitalk_lefty）に保存します。この端末のブラウザの中だけにあり、運営側には送られません。</li>
        <li><b>効果音の音量</b>: 0〜150%の数字を、同じく localStorage（キー名 pochitalk_sfx_vol）に保存します。この端末のブラウザの中だけにあり、運営側には送られません。</li>
        <li><b>入力レベル</b>: マイクの増幅（0〜30dB）の数字を、同じく localStorage（キー名 pochitalk_input_db）に保存します。この端末のブラウザの中だけにあり、運営側には送られません。</li>
        <li><b>VOXのしきい値</b>: 1〜10の数字を、同じく localStorage（キー名 pochitalk_vox_thr）に保存します。この端末のブラウザの中だけにあり、運営側には送られません。</li>
        <li>Cookie、ログイン情報、メールアドレス、位置情報、連絡先などは、保存も取得もしません。</li>
        <li>アクセス解析や広告の仕組みは入れていません。</li>
      </ul>

      <h4>サーバー側に保存されるもの</h4>
      <ul>
        <li>このアプリの運営側には、データベースや保存領域がなく、ユーザーの名前・部屋・音声・通話履歴を保存していません。</li>
        <li>ただし、ページを配信している Cloudflare には、一般的なアクセス情報（IPアドレスなど）が、同社の方針に沿って記録されることがあります。</li>
      </ul>

      <h4>外部のサービスについて</h4>
      <ul>
        <li><b>esm.sh</b>: 通話用のライブラリ（Trystero）の配信元です。ページを開くと、ここにもアクセスが発生します。QRコードを作るライブラリも、ここから配信されます（QRのボタンを押したときだけ読み込みます。QRは、端末の中で作られ、招待URLは外に送られません）。</li>
        <li><b>Nostr の公開リレー</b>: 通話相手を見つけるための接続情報のやり取りと、部屋の一覧のための在室の知らせ（部屋のハッシュ、ハンドルネーム、話題タグ、話しているか）の送受信に使います。内容は暗号化されますが、接続元IPなどのアクセス情報はリレーの運営者に見える可能性があります。</li>
        <li><b>STUN / TURNサーバー（Cloudflare・Google）</b>: 端末どうしが直接つながるための、公開されたアドレスの確認に使います。IPアドレスがこれらに送られます。</li>
        <li>これらは運営側が管理していない外部のサービスです。</li>
      </ul>

      <h3>ご注意</h3>
      <ul>
        <li>個人が作ったα版です。動作や安全性は保証できません。重要な連絡や緊急時の連絡には使わないでください。</li>
        <li>回線やNATの種類によっては、相手とつながらないことがあります。</li>
        <li>他人への迷惑行為や、他人の会話の録音・公開はしないでください。</li>
      </ul>
      </div>
    </div>
  </dialog>

  <script>
    // 診断用: 通話の接続（RTCPeerConnection）の、作成・状態の変化・TURN のエラーを、短く記録する（画面の診断に出す）
    (function () {
      const Orig = window.RTCPeerConnection;
      if (!Orig) return;
      window.pcLog = [];
      window.pcCount = { created: 0, closed: 0, failed: 0 };
      window.pcLive = new Set(); // まだ閉じていない接続（退出時に、使った接続を実際に閉じるために使う）
      window.pcClock = function () { const d = new Date(); return ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); };
      function t() { const d = new Date(); return ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
      function add(s) { window.pcLog.push(t() + ' ' + s); if (window.pcLog.length > 80) window.pcLog.shift(); }
      function P(cfg, c) {
        const pc = new Orig(cfg, c);
        const n = ++window.pcCount.created;
        const t0 = Date.now();
        add('#' + n + ' 作成（経路 ' + ((cfg && cfg.iceTransportPolicy) || 'all') + ' / ICEサーバー ' + ((cfg && cfg.iceServers && cfg.iceServers.length) || 0) + '）');
        window.pcLive.add(pc);
        const candCount = { host: 0, srflx: 0, relay: 0 }; // 失敗の原因を探すため、集まった候補の種類を数える（relay が 0 なら、TURN を使えていない）
        pc.addEventListener('icecandidate', function (e) { if (e && e.candidate && e.candidate.type && candCount[e.candidate.type] !== undefined) candCount[e.candidate.type]++; });
        // 届いた音声トラックを、通話の部品（Trystero）を通さずにアプリへ渡す。Trystero は「相手側のストリーム id」で同じ物と見なすので、
        // 相手が同じストリームを入れ直したときの新しいトラックを知らせてくれないことがある（ぽっと通話 v0.14.20 と同じ回避）
        pc.addEventListener('track', function (e) { try { if (window.pochiTrack) window.pochiTrack(pc, e); } catch (_) {} });
        let seenIce = '', seenConn = '';
        pc.addEventListener('iceconnectionstatechange', function () { if (pc.iceConnectionState !== seenIce) { seenIce = pc.iceConnectionState; add('#' + n + ' ice:' + seenIce + '（' + Math.round((Date.now() - t0) / 100) / 10 + '秒）'); if (seenIce === 'failed') add('#' + n + ' 失敗の詳細: 候補 host=' + candCount.host + ' srflx=' + candCount.srflx + ' relay=' + candCount.relay + ' / 相手の記述 ' + (pc.remoteDescription ? 'あり' : 'なし') + ' / signaling ' + pc.signalingState);
          // 失敗した接続の、候補の組み合わせ（ペア）を調べる: 相手の候補が届いていたか、何組を試して、何組に返事があったか
          try {
            pc.getStats().then(function (stats) {
              const rc = { host: 0, srflx: 0, relay: 0, prflx: 0 }; let pairs = 0, tried = 0, answered = 0, sent = 0;
              stats.forEach(function (r) {
                if (r.type === 'remote-candidate' && rc[r.candidateType] !== undefined) rc[r.candidateType]++;
                if (r.type === 'candidate-pair') { pairs++; if ((r.requestsSent || 0) > 0) tried++; if ((r.responsesReceived || 0) > 0) answered++; sent += r.requestsSent || 0; }
              });
              add('#' + n + ' 失敗のペア: 相手の候補 relay=' + rc.relay + ' srflx=' + rc.srflx + ' host=' + rc.host + ' / ペア ' + pairs + '（試した ' + tried + '・返事あり ' + answered + '・送信 ' + sent + '）');
            }).catch(function () {});
          } catch (_) {}
        } });
        pc.addEventListener('connectionstatechange', function () {
          if (pc.connectionState !== seenConn) { seenConn = pc.connectionState; add('#' + n + ' conn:' + seenConn + '（' + Math.round((Date.now() - t0) / 100) / 10 + '秒）'); }
          if (pc.connectionState === 'failed') window.pcCount.failed++;
        });
        pc.addEventListener('icecandidateerror', function (e) { if (e && e.errorCode >= 300) add('#' + n + ' ICEエラー ' + e.errorCode + ' ' + String(e.errorText || '').slice(0, 40) + ' ' + String(e.url || '').slice(0, 40)); });
        const oc = pc.close;
        pc.close = function () { if (window.pcLive.delete(pc)) { window.pcCount.closed++; add('#' + n + ' close'); } return oc.apply(pc, arguments); };
        return pc;
      }
      P.prototype = Orig.prototype;
      Object.setPrototypeOf(P, Orig);
      window.RTCPeerConnection = P;
    })();
  </script>
  <script type="module">
    import { joinRoom, selfId } from '/vendor/trystero-0.25.4-p8.mjs';

    const pttBtn = document.getElementById('pttBtn');
    const ledTx = document.getElementById('ledTx');
    const ledRx = document.getElementById('ledRx');
    const statusLabel = document.getElementById('statusLabel');
    const roomDisplay = document.getElementById('roomDisplay');
    const chDisplay = document.getElementById('chDisplay');
    const freqDisplay = document.getElementById('freqDisplay');
    const lcdSub = document.getElementById('lcdSub');
    const scanList = document.getElementById('scanList');
    const onlineCount = document.getElementById('onlineCount');
    const peersList = document.getElementById('peersList');
    const nameInput = document.getElementById('nameInput');
    const soundEffectCheck = { checked: true }; // 効果音のオン・オフは廃止（音量 0% で消せる）

    const rxAnalysers = new Map(); // peerId -> AnalyserNode
    let sendJoinAge = null, roomEnterTime = 0;
    let sendTag = null, roomMeta = { tag: '', by: '', at: 0 }; // 話題タグ（誰でも上書き・新しいものが勝つ）
    let txAnalyser = null;
    let sendStream = null, micGain = null, micSrc = null, micTest = false, inputDb = 0;
    let micSendGain = null, morseOsc = null, morseGain = null; // モールス送信用
    let faxOsc = null, faxGain = null, faxSideGain = null; // FAX送信用
    let audioCtx = null, userMediaStream = null, localAudioTrack = null, noMic = false; // noMic: マイクの機器がない端末（モールス・FAXの音だけ送れる）
    let room = null, sendPttState = null, sendNickname = null, sendFaxPage = null;
    let isTransmitting = false, currentTalkerId = null;
    const peerMap = new Map();

    // ===== ICE / TURN（po_call の安定化方式を移植）=====
    // ・TURN が取れている間は中継固定（relay）: キャリア回線でも経路が一本に定まって安定し、相手に IP も見えなくなる。
    //   取れていないときだけ従来どおり STUN＋直接（relay を強制すると候補ゼロで誰も繋がらない）。
    // ・iceServersNow は「同じ配列の中身だけ入れ替える」安定参照。Trystero は接続を作るたびに
    //   rtcConfig.iceServers を参照で読むため、通話中に入れ替えても以降の参加者には新しい資格情報が渡る。
    // ・資格情報は10分キャッシュ、5分ごとに取り直し。失敗しても前回の資格情報が生きていればそれを使う。
    const GOOGLE_STUN = { urls: 'stun:stun.l.google.com:19302' };
    const iceServersNow = [
      { urls: 'stun:stun.cloudflare.com:3478' },
      GOOGLE_STUN
    ];
    let iceFetchedAt = 0;
    const ICE_CACHE_MS = 10 * 60 * 1000;
    async function refreshIceServers(force) {
      if (!force && iceFetchedAt && Date.now() - iceFetchedAt < ICE_CACHE_MS) return;
      try {
        const res = await fetch('/api/turn', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
          iceServersNow.splice(0, iceServersNow.length, ...data.iceServers, GOOGLE_STUN);
          iceFetchedAt = Date.now();
        }
      } catch (_) {}
    }
    // 中継固定にすると、接続の準備が、相手の応答に間に合いにくく、つながりにくくなる（通話の部品の作り上）。通常は、直接を優先し、つながらないときだけ TURN 中継にする。固定したいときは ?relay=1 を付けて開く
    let relayStored = true; // 既定は中継のみ。設定でオフにした端末だけ、直接を優先
    try { relayStored = localStorage.getItem('pochitalk_relay') !== '0'; } catch (_) {}
    const FORCE_RELAY = new URLSearchParams(location.search).has('relay') || relayStored;
    function getRtcConfig() {
      // Trystero 0.25.4 は、rtcConfig を RTCPeerConnection の設定として、そのまま使う（0.20.0 のような config の入れ子は不要）
      return iceFetchedAt > 0
        ? { iceServers: iceServersNow, iceTransportPolicy: FORCE_RELAY ? 'relay' : 'all' }
        : { iceServers: iceServersNow };
    }
    // シグナリング用 Nostr リレー（po_call と同じ顔ぶれを全本使う）
    // 通話の識別名。Trystero 0.25.x は、0.20.0 と通信の形式が違うため、識別名も新しくして、古い版とは別の世界にする
    const APP_ID = 'pochitalk-v2';
    const NOSTR_RELAY_URLS = ['wss://relay.primal.net', 'wss://purplerelay.com', 'wss://bucket.coracle.social', 'wss://yabu.me/v2', 'wss://x.kojira.io', 'wss://relay.notoshi.win', 'wss://relay.ditto.pub'];
    // 使うリレーは、起動時に、動いているものを選ぶ。接続の準備の数は、リレーの数に比例して増え、落ちているリレーは再試行を繰り返すため
    let ROOM_RELAYS = NOSTR_RELAY_URLS, aliveRelays = NOSTR_RELAY_URLS;
    function probeRelayMain(url) {
      return new Promise(function (resolve) {
        let settled = false, ws = null, timer = null;
        const done = function (ok) { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
        try { ws = new WebSocket(url); } catch (_) { done(false); return; }
        timer = setTimeout(function () { done(false); }, 6000);
        ws.onopen = function () { done(true); try { ws.close(); } catch (_) {} };
        ws.onerror = function () { done(false); };
        ws.onclose = function () { done(false); };
      });
    }
    (async function pickRelaysMain() {
      try {
        const res = await Promise.all(NOSTR_RELAY_URLS.map(function (u) { return probeRelayMain(u).then(function (ok) { return { u: u, ok: ok }; }); }));
        const alive = res.filter(function (r) { return r.ok; }).map(function (r) { return r.u; }).sort(function () { return Math.random() - 0.5; });
        if (alive.length >= 1) { aliveRelays = alive; ROOM_RELAYS = alive; } // 動いているリレーは全部使う。端末ごとにばらばらに選ぶと、選んだ先が重ならない組み合わせができ、つながりにくくなる
        if (pres.started) {
          // 調べる前に開いてしまった、選ばれなかったリレーとの接続は閉じる（負荷と通信を減らす）
          pres.socks.forEach(function (ws, url) { if (aliveRelays.indexOf(url) < 0) { pres.socks.delete(url); try { ws.close(); } catch (_) {} } });
          aliveRelays.forEach(presenceOpen);
        }
      } catch (_) {}
    })();

    const urlParams = new URLSearchParams(window.location.search);
    function isKey(k) { return /^[0-9a-f]{8}$/.test(k); }
    function fmt(k) { return k.slice(0, 4).toUpperCase() + '·' + k.slice(4).toUpperCase(); }
    function toHex(bytes) { return Array.from(bytes).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
    async function hashOf(name) {
      const norm = name.trim().toLowerCase().normalize('NFKC');
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
      return toHex(new Uint8Array(buf).slice(0, 4));
    }
    let currentKey = null;
    let savedName = null;
    try { savedName = localStorage.getItem('pochitalk_ptt_name'); } catch (_) {}
    let myNickname = savedName || ('無線機_' + Math.floor(Math.random() * 899 + 100));
    nameInput.value = myNickname;

    // 効果音の音量（0〜150%）。効果音はすべてこのゲインを通す。マイク（送信）には影響しない
    let sfxVol = 1, sfxGainNode = null, speakerMuted = false;
    function sfxOut(ctx) {
      if (!sfxGainNode || sfxGainNode.context !== ctx) {
        sfxGainNode = ctx.createGain();
        sfxGainNode.connect(ctx.destination);
      }
      sfxGainNode.gain.value = speakerMuted ? 0 : sfxVol;
      return sfxGainNode;
    }

    function getAudioContext() {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state !== 'running') audioCtx.resume().catch(function () {}); // iOS は 'interrupted' になることもある
      return audioCtx;
    }

    // 操作のたびに、止まっている音声を再開する（受信のレベルメーターやモールスの判定は、音声が止まっていると、まったく動かない）
    ['pointerdown', 'touchend', 'keydown', 'click'].forEach(function (ev) {
      document.addEventListener(ev, function () { unlockAudio(); }, true);
    });

    function playPttStartTone() {
      if (!soundEffectCheck.checked) return;
      try {
        const ctx = getAudioContext();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.connect(gain); gain.connect(sfxOut(ctx));
        osc.start(); osc.stop(ctx.currentTime + 0.08);
      } catch (_) {}
    }

    // 発話終了: ザラザラに歪んだノイズを細かく途切れさせた「ガガッ」
    function playPttEndTone() {
      if (!soundEffectCheck.checked) return;
      try {
        const ctx = getAudioContext();
        const sr = ctx.sampleRate;
        const dur = 0.16;
        const buffer = ctx.createBuffer(1, Math.floor(sr * dur), sr);
        const d = buffer.getChannelData(0);
        let held = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          if (i % 5 === 0) held = Math.random() * 2 - 1;      // 粗いサンプルホールド = ザラつき
          const gate = (Math.floor(t * 22) % 2 === 0) ? 1 : 0.15; // ガ・ガ・ガ と細かく途切れる
          const decay = t < 0.09 ? 1 : Math.max(0, 1 - (t - 0.09) / 0.07); // 最後にスッと切れる
          d[i] = held * gate * decay;
        }
        const src = ctx.createBufferSource(); src.buffer = buffer;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
        // 歪ませてバリバリ感を出す
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(256);
        for (let k = 0; k < 256; k++) { const x = (k / 128) - 1; curve[k] = Math.tanh(x * 5); }
        shaper.curve = curve;
        const g = ctx.createGain(); g.gain.value = 0.14;
        src.connect(hp); hp.connect(lp); lp.connect(shaper); shaper.connect(g); g.connect(sfxOut(ctx));
        src.start();
      } catch (_) {}
    }

    // 話中ブザー（他の人が話しているときに押した）
    function playBusyTone() {
      if (!soundEffectCheck.checked) return;
      try {
        const ctx = getAudioContext();
        [0, 0.12].forEach(function (off) {
          const osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = 'square'; osc.frequency.value = 330;
          g.gain.setValueAtTime(0.06, ctx.currentTime + off);
          g.gain.setValueAtTime(0.001, ctx.currentTime + off + 0.08);
          osc.connect(g); g.connect(sfxOut(ctx));
          osc.start(ctx.currentTime + off); osc.stop(ctx.currentTime + off + 0.09);
        });
      } catch (_) {}
    }

    // 混線ノイズ（荒く揺れる広帯域ノイズ）
    function playCrosstalk() {
      if (!soundEffectCheck.checked) return;
      try {
        const ctx = getAudioContext();
        const sr = ctx.sampleRate, dur = 0.7;
        const buffer = ctx.createBuffer(1, Math.floor(sr * dur), sr);
        const d = buffer.getChannelData(0);
        let held = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          if (i % 3 === 0) held = Math.random() * 2 - 1;
          const wob = 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 9);
          d[i] = held * wob * Math.max(0, 1 - t / dur);
        }
        const src = ctx.createBufferSource(); src.buffer = buffer;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.5;
        const g = ctx.createGain(); g.gain.value = 0.2;
        src.connect(bp); bp.connect(g); g.connect(sfxOut(ctx));
        src.start();
      } catch (_) {}
    }

    function showCrosstalk() {
      playCrosstalk();
      statusLabel.textContent = '混線！';
      statusLabel.style.color = '#f59e0b';
      clearTimeout(showCrosstalk.t);
      showCrosstalk.t = setTimeout(function () {
        if (!isTransmitting && !currentTalkerId) {
          statusLabel.textContent = 'STANDBY';
          statusLabel.style.color = '#38bdf8';
        }
      }, 1300);
    }

    function othersTalking() {
      let n = 0;
      peerMap.forEach(function (p) { if (p.isTalking) n++; });
      return n;
    }

    // 入室音: 「ピコーン」（短い高音のあとに、伸びる高音）
    function playEnterTone() {
      if (!soundEffectCheck.checked) return;
      try {
        const ctx = getAudioContext();
        const t0 = ctx.currentTime;
        function note(freq, start, dur, vol) {
          const osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t0 + start);
          g.gain.setValueAtTime(0.001, t0 + start);
          g.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur);
          osc.connect(g); g.connect(sfxOut(ctx));
          osc.start(t0 + start); osc.stop(t0 + start + dur + 0.02);
        }
        note(1046.5, 0.00, 0.09, 0.14);   // ピ
        note(1568.0, 0.08, 0.60, 0.14);   // コーン
        note(3136.0, 0.08, 0.30, 0.03);   // 響きの倍音
      } catch (_) {}
    }

    // マイク → 入力レベル(ゲイン) → [レベル計 / 送信用ストリーム]
    function buildMicGraph(raw) {
      const ctx = getAudioContext();
      micSrc = raw ? ctx.createMediaStreamSource(raw) : null;
      micGain = ctx.createGain();
      micGain.gain.value = Math.pow(10, inputDb / 20);
      txAnalyser = ctx.createAnalyser();
      txAnalyser.fftSize = 1024;
      txAnalyser.smoothingTimeConstant = 0.6;
      const dest = ctx.createMediaStreamDestination();
      if (micSrc) micSrc.connect(micGain);
      micGain.connect(txAnalyser);
      micSendGain = ctx.createGain();
      micGain.connect(micSendGain);
      micSendGain.connect(dest);
      // モールス送信用トーン（普段は無音。モールス送信中はマイク側を絞ってトーンだけを送る）
      morseOsc = ctx.createOscillator();
      morseOsc.type = 'sine';
      morseOsc.frequency.value = 700;
      morseGain = ctx.createGain();
      morseGain.gain.value = 0;
      morseOsc.connect(morseGain);
      morseGain.connect(dest);
      morseGain.connect(txAnalyser);
      morseGain.connect(sfxOut(ctx));
      morseOsc.start();
      // FAX送信用トーン（周波数を切り替えて使う）
      faxOsc = ctx.createOscillator();
      faxOsc.type = 'sine';
      faxOsc.frequency.value = 1500;
      faxGain = ctx.createGain();
      faxGain.gain.value = 0;
      faxOsc.connect(faxGain);
      faxGain.connect(dest);
      faxGain.connect(txAnalyser);
      faxSideGain = ctx.createGain();
      faxSideGain.gain.value = 0.3; // 自分の耳に返す音は小さめに（つんざくので）
      faxGain.connect(faxSideGain);
      faxSideGain.connect(sfxOut(ctx));
      faxOsc.start();
      sendStream = dest.stream;
      localAudioTrack = sendStream.getAudioTracks()[0];
      localAudioTrack.enabled = false;
    }

    // マイクを完全に解放する（ブラウザのマイク使用中表示も消える）
    function releaseMic() {
      abortMorse();
      abortFax();
      unsendStreams();
      try { if (micSrc) micSrc.disconnect(); if (micGain) micGain.disconnect(); } catch (_) {}
      [userMediaStream, sendStream].forEach(function (st) {
        if (st) st.getTracks().forEach(function (t) { t.stop(); });
      });
      try { if (morseOsc) { morseOsc.stop(); morseOsc.disconnect(); } if (morseGain) morseGain.disconnect(); if (micSendGain) micSendGain.disconnect(); if (faxOsc) { faxOsc.stop(); faxOsc.disconnect(); } if (faxGain) faxGain.disconnect(); if (faxSideGain) faxSideGain.disconnect(); } catch (_) {}
      userMediaStream = null; sendStream = null; localAudioTrack = null; noMic = false;
      micSrc = null; micGain = null; txAnalyser = null;
      micSendGain = null; morseOsc = null; morseGain = null;
    }

    let micPending = null;
    async function initMicrophone(quiet) {
      if ((userMediaStream || noMic) && localAudioTrack) return true;
      if (micPending) return micPending;
      micPending = (async function () {
        try {
          const st = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
          });
          if (!room && !micTest) { st.getTracks().forEach(function (t) { t.stop(); }); return false; } // 取得中に退出した
          userMediaStream = st;
          buildMicGraph(st);
          sendStreamTo(); healSoon();
          return true;
        } catch (err) {
          // マイクの機器そのものがない端末（デスクトップPCなど）。声は送れないが、モールスとFAXの音は送れるので、マイクなしで送信の準備をする
          if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') && (room || micTest)) {
            try {
              noMic = true;
              buildMicGraph(null);
              sendStreamTo();
              flashSub('マイクが見つかりません。声は送れませんが、モールスは送れます');
              return true;
            } catch (_) { noMic = false; }
          }
          if (!quiet) alert('マイクの許可が必要です（HTTPS接続が必要）: ' + err.message);
          return false;
        }
      })();
      const ok = await micPending;
      micPending = null;
      return ok;
    }


    // Trystero 0.25.4 の API 差を吸収する小さな部品（0.20.0 の書き方のまま、呼び出し側を動かすため）
    //  ・makeAction は、{ send, onMessage } を返す。受信は onMessage(data, { peerId })。送信は send(data, { target })
    //  ・onPeerJoin / onPeerLeave / onPeerStream は、関数を代入して設定する
    function actionOf(r, id) {
      const a = r.makeAction(id);
      return [
        function (data, peerId) { return a.send(data, peerId ? { target: peerId } : undefined); },
        function (handler) { a.onMessage = function (data, info) { handler(data, info && info.peerId); }; }
      ];
    }
    function setHandler(r, name, fn) { r[name] = fn; }

    // 相手の音声を、再生要素と解析（レベル計・モールス・FAX）に載せる。onPeerStream と、接続の track イベント（pochiTrack）の両方から呼ぶ。
    // Trystero は同じ相手から「古いストリーム」を知らせてくることがあるので、終わったトラックしか無い物は捨て、鳴っている物を黙った物で置き換えない
    const rxSources = new Map(); // peerId -> [MediaStreamAudioSourceNode] 解析に使っている入力（載せ替えるときに外す）
    function attachRemoteAudio(peerId, stream, fromTrack) {
      if (!room || !peerMap.has(peerId) || !stream) return;
      const tracks = stream.getAudioTracks().filter(function (t) { return t.readyState === 'live'; });
      if (!tracks.length) return;
      let el = document.getElementById('audio-' + peerId);
      if (el && el.srcObject) {
        const cur = el.srcObject.getAudioTracks();
        if (cur.some(function (t) { return tracks.some(function (u) { return u.id === t.id; }); })) return; // 同じ物が、もう載っている
        if (!fromTrack && cur.some(function (t) { return t.readyState === 'live' && !t.muted; }) && tracks.every(function (t) { return t.muted; })) return;
      }
      if (!el) {
        el = document.createElement('audio');
        el.id = 'audio-' + peerId;
        el.autoplay = true;
        el.playsInline = true;
        el.muted = speakerMuted;
        document.body.appendChild(el);
      }
      el.srcObject = stream;
      try {
        (rxSources.get(peerId) || []).forEach(function (s) { try { s.disconnect(); } catch (_) {} });
        const ctx = getAudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        an.smoothingTimeConstant = 0.6;
        const s1 = ctx.createMediaStreamSource(stream); s1.connect(an);
        rxAnalysers.set(peerId, an);
        const dan = ctx.createAnalyser();
        dan.fftSize = 1024;
        dan.smoothingTimeConstant = 0.05;
        const s2 = ctx.createMediaStreamSource(stream); s2.connect(dan);
        rxSources.set(peerId, [s1, s2]);
        rxDecoders.set(peerId, { an: dan, freq: new Uint8Array(dan.frequencyBinCount), tone: false, toneAt: 0, offAt: 0, pat: '', text: '', letterDone: false, wordDone: false });
      } catch (_) {}
      el.play().catch(function () { showUnlockHint(); }); // iPhone は操作の文脈の外では再生を弾くことがある。次のタップで鳴らし直す
    }
    window.pochiTrack = function (pc, e) {
      if (!room || !e || !e.track || e.track.kind !== 'audio') return;
      let pcs; try { pcs = room.getPeers(); } catch (_) { return; }
      const id = Object.keys(pcs).find(function (k) { return pcs[k] === pc; });
      if (id) attachRemoteAudio(id, new MediaStream([e.track]), true);
    };
    // 相手が参加扱いになる前に届いていたトラックを拾う（中身が流れている物だけ）
    function pickupReceivedTracks(peerId) {
      let pc; try { pc = room && room.getPeers()[peerId]; } catch (_) {}
      if (!pc) return;
      pc.getReceivers().forEach(function (r) {
        const t = r.track;
        if (t && t.kind === 'audio' && t.readyState === 'live' && !t.muted) attachRemoteAudio(peerId, new MediaStream([t]), true);
      });
    }

    // 再生が弾かれたときの受け皿（iPhone・低電力モードなど）。出ている間は、画面のどこをタップしても鳴らし直す
    let audioLocked = false;
    function showUnlockHint() {
      if (audioLocked) return;
      audioLocked = true;
      toast('音が止まっています。画面をどこかタップすると鳴ります');
      flashSub('音が止まっています。画面をタップしてください');
    }
    function unlockAudio() {
      if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(function () {});
      if (!audioLocked) return;
      audioLocked = false;
      document.querySelectorAll('audio[id^="audio-"]').forEach(function (a) { a.play().catch(function () { audioLocked = true; }); });
    }

    // 送信ストリームは、相手ごとに新しい MediaStream に包んで渡す。Trystero は送信側の MediaStream オブジェクトごとに固定の鍵を振り、
    // 受信側はその鍵で古いストリームを返すため、同じ物を外して入れ直しても相手に新しいトラックが届かない
    const sentStreams = new Map(); // peerId -> 相手に渡した MediaStream
    function sendStreamTo(peerId) {
      if (!room || !sendStream) return;
      const ids = peerId ? [peerId] : Array.from(peerMap.keys());
      ids.forEach(function (id) {
        if (sentStreams.has(id)) return;
        const ms = new MediaStream(sendStream.getTracks());
        sentStreams.set(id, ms);
        try { room.addStream(ms, { target: id }); } catch (_) { sentStreams.delete(id); }
      });
    }
    function unsendStreams() {
      if (room) sentStreams.forEach(function (ms, id) { try { room.removeStream(ms, { target: id }); } catch (_) {} });
      sentStreams.clear();
    }

    // 部屋を出るときは、相手との接続（RTCPeerConnection）を実際に閉じる。Trystero 0.25 は同じアプリの相手との接続を部屋をまたいで
    // 持ち続け、leave() では閉じない。しかも退出時の removeTrack で作られる再交渉の offer は送り先が無く、接続が固まったまま残る。
    // 同じ相手と同じ部屋で入り直すと、その固まった接続が使い回されて、音声だけ通らなくなる
    function closeOldConnections(oldRoom) {
      const stale = window.pcLive ? Array.from(window.pcLive).filter(function (pc) { try { return !!pc.remoteDescription; } catch (_) { return false; } }) : [];
      const done = function () { stale.forEach(function (pc) { try { pc.close(); } catch (_) {} }); };
      return Promise.resolve(oldRoom ? oldRoom.leave() : null).catch(function () {}).then(done);
    }

    function connectToChannel(key) {
      roomEnterTime = Date.now();
      roomMeta = { tag: '', by: '', at: 0 };
      closeTagForm(); // 部屋を移ったら、開いていた編集欄は閉じる
      renderTagRow();
      const roomId = 'h-' + key;
      if (room) {
        closeOldConnections(room);
        peerMap.clear();
        sentStreams.clear();
        rxAnalysers.clear();
        rxDecoders.clear();
        currentTalkerId = null;
        document.querySelectorAll('audio[id^="audio-"]').forEach(function (a) { a.remove(); });
        ledRx.classList.remove('active');
        renderPeers();
      }
      room = joinRoom({
        appId: APP_ID,
        relayConfig: { urls: ROOM_RELAYS, warnOnRelayFailure: false },
        rtcConfig: getRtcConfig()
      }, roomId, { onJoinError: function (d) { try { console.warn('join error:', d && d.error); } catch (_) {} } });

      // makeAction は同じ名前を1回しか登録できないので、送受信を一度に受け取る
      const pttStateAction = actionOf(room, 'pttState');
      const nameAction = actionOf(room, 'pttName');
      sendPttState = pttStateAction[0];
      sendNickname = nameAction[0];

      // 話題タグ: 全員へ送る。新しい(at が大きい)ほうを採用する
      const tagAction = actionOf(room, 'roomTag');
      sendTag = tagAction[0];
      tagAction[1](function (data) {
        if (isBotRoom(currentKey)) return; // ボットの部屋のタグは、固定（ほかの人が送ってきても、受け付けない）
        if (!data || typeof data.at !== 'number' || data.at <= roomMeta.at) return;
        roomMeta = { tag: capTag(data.tag), by: String(data.by || '').slice(0, 12), at: data.at };
        renderTagRow(); announce(); renderScan();
      });

      // 入室してからの経過時間を交換し、新しく来たほうを判定する（既存の人にだけ入室音を鳴らす）
      const faxAction = actionOf(room, 'faxPage');
      sendFaxPage = faxAction[0];
      faxAction[1](function (data, peerId) { onFaxPage(data, peerId); });

      const joinAction = actionOf(room, 'joinAge');
      sendJoinAge = joinAction[0];
      joinAction[1](function (data, peerId) {
        const peer = peerMap.get(peerId);
        if (peer && data && typeof data.age === 'number') { peer.enteredAt = Date.now() - data.age; setTimeout(checkRoomFull, 500); }
        if (!peer || peer.joinJudged || !data || typeof data.age !== 'number') return;
        peer.joinJudged = true;
        const myAge = Date.now() - roomEnterTime;
        if (data.age < myAge - 1000) playEnterTone(); // 相手のほうが新しい = 相手が今入ってきた
      });

      nameAction[1](function (name, peerId) {
        const p = peerMap.get(peerId);
        if (p) { p.name = name; renderPeers(); }
      });

      pttStateAction[1](function (state, peerId) {
        const peer = peerMap.get(peerId);
        if (peer) peer.isTalking = state.isTalking;
        if (peer) {
          clearTimeout(peer.talkTimer);
          // 終わりの知らせが届かないまま、90秒続いたら、終わったことにする（話中ロックが、解除されなくなるのを防ぐ）
          if (state.isTalking) peer.talkTimer = setTimeout(function () {
            const p2 = peerMap.get(peerId);
            if (!p2 || !p2.isTalking) return;
            p2.isTalking = false;
            if (currentTalkerId === peerId) onStopReceiving();
            renderPeers();
          }, 90000);
        }
        if (state.isTalking) {
          resetRxDecode(peerId);
          currentTalkerId = peerId;
          if (isTransmitting) {
            // 同時に話し始めた: 両方とも送信が切れて混線
            pressed = false;
            stopTransmissionSilently();
            showCrosstalk();
            flashSub('混線！ もう一度押してください');
          } else if (othersTalking() >= 2) {
            showCrosstalk();
          } else {
            onStartReceiving((peer && peer.name) || '相手');
          }
        } else if (currentTalkerId === peerId) {
          setTimeout(function () { flushRxDecode(peerId); }, 600); // 音声の末尾が届き切ってから確定する
          onStopReceiving();
        }
        renderPeers();
      });

      setHandler(room, 'onPeerJoin', function (peerId) {
        if (window.pcLog) { window.pcLog.push(pcClock() + ' 相手が現れた ' + peerId.slice(0, 5)); }
        peerMap.set(peerId, { name: '接続中...', isTalking: false, joinJudged: false });
        renderPeers();
        setTimeout(checkRoomFull, 3000);
        sendNickname(myNickname, peerId);
        if (sendJoinAge) sendJoinAge({ age: Date.now() - roomEnterTime }, peerId);
        if (sendTag && roomMeta.at > 0) sendTag(roomMeta, peerId); // 後から来た人にも今のタグを伝える
        // 相手が経過時間を送ってこない場合（別の実装など）: 自分が20秒以上いるなら、相手は新規とみなす
        const ageAtJoin = Date.now() - roomEnterTime;
        setTimeout(function () {
          const p = peerMap.get(peerId);
          if (p && !p.joinJudged) { p.joinJudged = true; if (ageAtJoin > 20000) playEnterTone(); }
        }, 2500);
        // 両方の端末が同時に音声を足すと、取り決め（オファー）がぶつかって、片方向になる。IDの小さい側が先に足し、大きい側は、少し待ってから足す
        setTimeout(function () { if (room && peerMap.has(peerId)) { sendStreamTo(peerId); healSoon(); } }, selfId < peerId ? 0 : 2500);
        pickupReceivedTracks(peerId);
      });

      setHandler(room, 'onPeerLeave', function (peerId) {
        if (window.pcLog) { const lm = peerMap.get(peerId); window.pcLog.push(pcClock() + ' 相手が去った ' + ((lm && lm.name) || peerId.slice(0, 5))); }
        peerMap.delete(peerId);
        sentStreams.delete(peerId);
        rxAnalysers.delete(peerId);
        rxSources.delete(peerId);
        rxDecoders.delete(peerId);
        faxDecoders.delete(peerId);
        cancelFaxReveal(peerId);
        if (currentTalkerId === peerId) onStopReceiving();
        const el = document.getElementById('audio-' + peerId);
        if (el) el.remove();
        renderPeers();
      });

      setHandler(room, 'onPeerStream', function (stream, peerId) { attachRemoteAudio(peerId, stream, false); });
    }

    const peerCountEl = document.getElementById('peerCount');
    // 音声が通る相手の数。つながっていても、音声の取り決めが外れている相手（向き sendrecv→なし）は、数えない
    function audioStuck(pc) {
      try {
        return pc.connectionState !== 'connected' || pc.getTransceivers().some(function (t) {
          return t.sender && t.sender.track && (t.direction === 'sendrecv' || t.direction === 'sendonly') && t.currentDirection === null;
        });
      } catch (_) { return false; }
    }
    function goodLinkCount() {
      let pcs = {}; try { pcs = room ? room.getPeers() : {}; } catch (_) { return peerMap.size; }
      let n = 0; Object.keys(pcs).forEach(function (id) { if (!audioStuck(pcs[id])) n++; });
      return n;
    }
    // つながりの良し悪しの順位。各端末が「自分がつながっている人数(cn)」を在室通知で共有している。少ない順に並べ、先頭が「入り直すべき端末」
    function linkRanking() {
      if (!currentKey) return null;
      const rows = [{ name: String(myNickname).slice(0, 12), cn: goodLinkCount(), ag: Math.floor((Date.now() - roomEnterTime) / 1000), me: true, key: pres.pub || 'zz' }];
      lobbyEntries.forEach(function (v, k) { if (v.ch === currentKey) rows.push({ name: v.name, cn: v.cn, ag: v.ag, me: false, key: k }); });
      const total = rows.length;
      const known = rows.filter(function (r) { return r.cn >= 0; });
      known.sort(function (a, b) { return a.cn - b.cn || (a.key < b.key ? -1 : 1); });
      // 入室して45秒たっていない端末は、まだ接続の最中なので、「入り直し」の対象にしない
      const mature = known.filter(function (r) { return r.ag >= 45; });
      const weakest = (known.length >= 2 && mature.length && mature[0].cn < total - 1) ? mature[0] : null; // 全員とつながっている端末が最下位なら、入り直しは不要
      return { rows: known, unknown: rows.length - known.length, total: total, weakest: weakest };
    }
    function updatePeerCount() {
      if (!currentKey) { peerCountEl.textContent = ''; return; }
      // 在室 = 一覧（Nostr）で見えている人 と 実際につながっている人 を、名前でまとめて数える（どちらかにしか見えない人も、数に入れる）
      const st = roomStats().get(currentKey);
      const connected = peerMap.size + 1;
      const all = new Set();
      all.add(String(myNickname).slice(0, 12));
      peerMap.forEach(function (info, id) { all.add(String(info.name || id.slice(0, 5)).slice(0, 12)); });
      if (st) st.names.forEach(function (n) { all.add(String(n).replace('(自分)', '').slice(0, 12)); });
      const present = Math.max(all.size, st ? st.count : 0, connected);
      peerCountEl.textContent = '接続 ' + connected + ' / 在室 ' + present;
      const goodAudio = goodLinkCount() + 1;
      if (goodAudio < connected) peerCountEl.textContent += '（音声OK ' + goodAudio + '）';
      peerCountEl.style.color = connected >= present ? '#4ade80' : '#fbbf24';
      const lr = linkRanking();
      if (lr && lr.weakest && lr.weakest.me) { peerCountEl.textContent += ' ⟳あなたが入り直す番'; peerCountEl.style.color = '#f87171'; }
    }
    function renderPeers() {
      updatePeerCount();
      announce(); // つながっている人数が変わったら、順位のため、すぐ知らせる（1秒に1回まで）
      peersList.innerHTML = '';
      // 自分（入室中のみ）。話しているときは赤で光る
      if (currentKey) {
        const me = document.createElement('span');
        me.className = 'peer-tag me' + (isTransmitting ? ' sending' : '');
        me.textContent = myNickname + '（自分）';
        peersList.appendChild(me);
      }
      peerMap.forEach(function (info, id) {
        const span = document.createElement('span');
        span.className = 'peer-tag' + (info.isTalking ? ' talking' : '');
        span.textContent = info.name || id.slice(0, 5);
        peersList.appendChild(span);
      });
      if (mismatchNote) {
        const warn = document.createElement('span');
        warn.className = 'peers-empty';
        warn.style.color = '#fbbf24';
        warn.textContent = mismatchNote;
        peersList.appendChild(warn);
      }
      if (peerMap.size === 0) {
        const none = document.createElement('span');
        none.className = 'peers-empty';
        none.textContent = currentKey ? '（ほかの参加者を待っています）' : '待機中（参加者なし）';
        peersList.appendChild(none);
      }
    }

    function onStartReceiving(name) {
      ledRx.classList.add('active');
      statusLabel.textContent = 'RX: ' + name;
      statusLabel.style.color = 'var(--rx-color)';
    }

    function onStopReceiving() {
      ledRx.classList.remove('active');
      currentTalkerId = null;
      if (!isTransmitting) {
        statusLabel.textContent = 'STANDBY';
        statusLabel.style.color = '#38bdf8';
        playPttEndTone();
      }
    }

    let startPending = false;
    async function startTransmission(quiet) {
      if (isTransmitting || startPending) return;
      if (!room) { flashSub('先に部屋に入ってください'); return; }
      if (othersTalking() > 0) { if (!quiet) { playBusyTone(); flashSub('話中です'); } return; }
      startPending = true;
      getAudioContext();
      const ok = await initMicrophone();
      startPending = false;
      if (!ok) return;
      if (!pressed) return; // 許可ダイアログ中に指を離した場合
      if (othersTalking() > 0) { if (!quiet) { playBusyTone(); flashSub('話中です'); } return; }
      isTransmitting = true;
      renderPeers();
      localAudioTrack.enabled = true;
      pttBtn.classList.add('transmitting');
      ledTx.classList.add('active');
      statusLabel.textContent = 'TX (送信中)';
      statusLabel.style.color = 'var(--tx-color)';
      playPttStartTone();
      if (sendPttState) sendPttState({ isTalking: true });
      announce();
    }

    function stopTransmissionSilently() {
      if (faxTxActive) { abortFax(); return; }
      if (morseTxActive) { abortMorse(); return; }
      if (!isTransmitting) return;
      isTransmitting = false;
      if (localAudioTrack) localAudioTrack.enabled = false;
      pttBtn.classList.remove('transmitting');
      ledTx.classList.remove('active');
      renderPeers();
      if (sendPttState) sendPttState({ isTalking: false });
      announce();
    }

    function stopTransmission() {
      if (faxTxActive) { abortFax(); return; }
      if (morseTxActive) { abortMorse(); return; }
      if (!isTransmitting) return;
      isTransmitting = false;
      if (localAudioTrack) localAudioTrack.enabled = false;
      pttBtn.classList.remove('transmitting');
      ledTx.classList.remove('active');
      const talker = currentTalkerId && peerMap.get(currentTalkerId);
      if (talker) {
        onStartReceiving(talker.name);
      } else {
        statusLabel.textContent = 'STANDBY';
        statusLabel.style.color = '#38bdf8';
      }
      playPttEndTone();
      renderPeers();
      if (sendPttState) sendPttState({ isTalking: false });
      announce();
    }

    let pressed = false;
    function press() { if (isInviteMode()) { joinInvited(); return; } if (!currentKey) { createFromPtt(); return; } pressed = true; startTransmission(); }
    function release() { pressed = false; stopTransmission(); }

    pttBtn.addEventListener('mousedown', function (e) { e.preventDefault(); press(); });
    window.addEventListener('mouseup', function () { if (pressed) release(); });
    // タッチ操作: スワイプ中に指がボタンに触れても、話し始めないようにする
    //   ・押してから SWIPE_HOLD_MS のあいだ、指がほぼ動かなかったときだけ送信を始める（短いタップでは送信しない）
    //   ・指がボタンの外（SWIPE_MARGIN_PX 余裕あり）に出たらスワイプとみなし、送信を始めない／送信中なら直ちに止める
    //     ボタンの上での指の移動（滑り）は許容する
    const SWIPE_HOLD_MS = 120, SWIPE_MARGIN_PX = 14;
    let touchActive = false, touchSwiped = false, touchTimer = null, touchX = 0, touchY = 0;

    function endTouch() {
      clearTimeout(touchTimer); touchTimer = null;
      const swiped = touchSwiped;
      if (!currentKey && !swiped && touchActive) { touchActive = false; if (isInviteMode()) joinInvited(); else createFromPtt(); return; } // 部屋の外では、PTTボタンが「入室」か「新しい部屋」のボタン
      touchActive = false; touchSwiped = false;
      if (!swiped && pressed) release();
    }

    pttBtn.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (touchActive) return;
      touchActive = true; touchSwiped = false;
      const t = e.touches[0];
      touchX = t.clientX; touchY = t.clientY;
      clearTimeout(touchTimer);
      touchTimer = setTimeout(function () {
        touchTimer = null;
        if (touchActive && !touchSwiped) press();
      }, SWIPE_HOLD_MS);
    }, { passive: false });

    pttBtn.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (!touchActive || touchSwiped) return;
      const t = e.touches[0];
      // ボタン（円）の上にいる間は、動いてもスワイプとみなさない
      const r = pttBtn.getBoundingClientRect();
      const dist = Math.hypot(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
      if (dist <= r.width / 2 + SWIPE_MARGIN_PX) return;
      touchSwiped = true;
      clearTimeout(touchTimer); touchTimer = null;
      if (pressed) {
        pressed = false;
        const wasTx = isTransmitting;
        stopTransmissionSilently();
        if (wasTx) {
          const talker = currentTalkerId && peerMap.get(currentTalkerId);
          if (talker) onStartReceiving(talker.name);
          else { statusLabel.textContent = 'STANDBY'; statusLabel.style.color = '#38bdf8'; }
        }
      }
    }, { passive: false });

    pttBtn.addEventListener('touchend', function (e) { e.preventDefault(); endTouch(); }, { passive: false });
    pttBtn.addEventListener('touchcancel', function () { endTouch(); });

    // スペースキーで話す。部屋の中では、ページのスクロールやボタンの誤作動を完全に止める
    let spaceHeld = false;
    function isTyping() {
      const el = document.activeElement;
      if (!el) return false;
      if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
      return el.tagName === 'INPUT' && /^(text|search|url|email|number|password|tel)$/.test(el.type || 'text');
    }
    function spaceActive() {
      return !!currentKey && !document.getElementById('radioView').classList.contains('idle')
        && !document.querySelector('dialog[open]') && !isTyping() && !document.getElementById('radioView').classList.contains('flipped');
    }

    window.addEventListener('keydown', function (e) {
      if (e.code !== 'Space') return;
      if ((morsePlaying || morseQueue.length) && currentKey && !document.querySelector('dialog[open]') && !isTyping()) {
        e.preventDefault();
        if (!e.repeat) morseQueue.push(' ');
        return;
      }
      if (!spaceActive()) {
        // 部屋の外（ホーム画面など）でも、スペースキーでページがスクロールしないようにする。
        // 入力欄・ダイアログの中と、ボタンやチェックにフォーカスがあるときは、通常どおり。
        if (isTyping() || document.querySelector('dialog[open]')) return;
        const f = document.activeElement;
        if (f && (f.tagName === 'BUTTON' || f.tagName === 'A' || f.tagName === 'INPUT' || f.tagName === 'SUMMARY')) return;
        e.preventDefault();
        return;
      }
      e.preventDefault(); // 押しっぱなし（repeat）のスクロールも止める
      const el = document.activeElement;
      if (el && el !== document.body && el.blur) el.blur(); // フォーカス中のボタンやチェックが、スペースで動かないように
      if (!e.repeat && !spaceHeld) { spaceHeld = true; press(); }
    });

    window.addEventListener('keyup', function (e) {
      if (e.code !== 'Space') return;
      // 押している間にダイアログが開いても、送信が止まらなくならないように、離したら必ず終える
      if (spaceHeld) { e.preventDefault(); spaceHeld = false; release(); return; }
      if (spaceActive()) e.preventDefault();
    });
    window.addEventListener('blur', function () { if (spaceHeld) { spaceHeld = false; release(); } });

    // ---------- モールス送信（PCのみ: 文字キーを打つと、その文字の符号をトーンで送る） ----------
    const MORSE_CODE = {
      A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
      K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
      U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
      '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.', '0': '-----',
      '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '-': '-....-', ':': '---...', "'": '.----.', '"': '.-..-.', '(': '-.--.', ')': '-.--.-', '=': '-...-', '+': '.-.-.', '@': '.--.-.'
    };
    const MORSE_UNIT_MS = 100;
    const morseQueue = [];
    let morsePlaying = false, morseTxActive = false, morseSession = 0;

    function morseSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function morseKey(down) {
      if (!morseGain) return;
      const t = getAudioContext().currentTime;
      morseGain.gain.cancelScheduledValues(t);
      morseGain.gain.setTargetAtTime(down ? 0.35 : 0, t, 0.004);
    }
    function beginMorseTx() {
      morseTxActive = true;
      isTransmitting = true;
      if (micSendGain) micSendGain.gain.value = 0;
      if (localAudioTrack) localAudioTrack.enabled = true;
      ledTx.classList.add('active');
      statusLabel.textContent = 'TX (モールス送信中)';
      statusLabel.style.color = 'var(--tx-color)';
      renderPeers();
      if (sendPttState) sendPttState({ isTalking: true });
      announce();
    }
    function finishMorseTx() {
      if (!morseTxActive) return;
      morseTxActive = false;
      morseKey(false);
      if (micSendGain) micSendGain.gain.value = 1;
      if (localAudioTrack) localAudioTrack.enabled = false;
      isTransmitting = false;
      ledTx.classList.remove('active');
      const talker = currentTalkerId && peerMap.get(currentTalkerId);
      if (talker) onStartReceiving(talker.name);
      else { statusLabel.textContent = 'STANDBY'; statusLabel.style.color = '#38bdf8'; }
      lcdSub.textContent = '';
      renderPeers();
      if (sendPttState) sendPttState({ isTalking: false });
      announce();
    }
    function abortMorse() {
      morseSession++;
      morseQueue.length = 0;
      morsePlaying = false;
      finishMorseTx();
    }
    async function playMorseChar(ch, session, wideGap) {
      const pat = MORSE_CODE[ch];
      lcdSub.textContent = 'モールス: ' + ch + ' ' + pat.split('').map(function (s) { return s === '.' ? '・' : '−'; }).join('');
      for (let i = 0; i < pat.length; i++) {
        if (session !== morseSession) return false;
        morseKey(true);
        await morseSleep(pat[i] === '.' ? MORSE_UNIT_MS : MORSE_UNIT_MS * 3);
        morseKey(false);
        if (session !== morseSession) return false;
        if (i < pat.length - 1) await morseSleep(MORSE_UNIT_MS * (wideGap ? 1.5 : 1)); // 先頭文字は隙間を広めに（受信側の立ち上がりで埋まらないように）
      }
      if (session !== morseSession) return false;
      await morseSleep(MORSE_UNIT_MS);
      return true;
    }
    async function startMorse() {
      if (morsePlaying) return;
      if (!room || isTransmitting) { morseQueue.length = 0; return; }
      if (othersTalking() > 0) { playBusyTone(); flashSub('話中です'); morseQueue.length = 0; return; }
      morsePlaying = true;
      const ok = await initMicrophone();
      if (!ok) { morsePlaying = false; morseQueue.length = 0; flashSub('マイクの許可が必要です'); return; }
      if (!room || othersTalking() > 0) {
        if (room && othersTalking() > 0) { playBusyTone(); flashSub('話中です'); }
        morsePlaying = false; morseQueue.length = 0; return;
      }
      const session = ++morseSession;
      let firstCh = true;
      beginMorseTx();
      await morseSleep(700); // 打ち始める前の間（受信側の復号リセットと回線の落ち着き待ち。最初の文字を拾わせるため長め）
      while (morseQueue.length && session === morseSession) {
        const ch = morseQueue.shift();
        if (ch === ' ') { await morseSleep(MORSE_UNIT_MS * 6); continue; }
        if (!await playMorseChar(ch, session, firstCh)) break;
        firstCh = false;
        if (morseQueue.length && session === morseSession) await morseSleep(MORSE_UNIT_MS * 2);
      }
      morsePlaying = false;
      if (session === morseSession) finishMorseTx();
    }
    window.addEventListener('keydown', function (e) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!currentKey || !room) return;
      const rv = document.getElementById('radioView');
      if (rv.classList.contains('idle') || rv.classList.contains('flipped')) return;
      if (document.querySelector('dialog[open]') || isTyping()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (faxMode) exitFaxMode();
        faxCanvas.classList.add('hidden'); // 紙も隠す
        morseQueue.push('E', 'S', 'C'); // ESCを押したら、モールスでも「ESC」と送る
        startMorse();
        return;
      }
      // FAXモード（隠し）: 「fax」と打つと入る。ESCで解除
      if (faxMode) {
        if (faxTxActive) return;
        if (e.key === 'Enter') { e.preventDefault(); if (faxText) startFaxTx(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); faxText = faxText.slice(0, -1); renderFaxCompose(); return; }
        if (e.key && e.key.length === 1 && faxText.length < 24) { e.preventDefault(); faxText += e.key; renderFaxCompose(); }
        return;
      }
      if (e.key && e.key.length === 1) {
        faxProbe = (faxProbe + e.key.toLowerCase()).slice(-3);
        if (faxProbe === 'fax') { faxProbe = ''; e.preventDefault(); enterFaxMode(); return; }
      }
      if (e.key === 'Backspace') {
        if (morseQueue.length) { e.preventDefault(); morseQueue.pop(); }
        return;
      }
      // 日本語入力がオンのときは、e.key が「Process」になり、文字が取れない。物理キー（e.code）から、英字と数字を拾う
      let rawCh = e.key && e.key.length === 1 ? e.key : '';
      if (!rawCh && (e.key === 'Process' || e.keyCode === 229) && e.code) {
        const mm = /^Key([A-Z])$/.exec(e.code) || /^Digit([0-9])$/.exec(e.code);
        if (mm) rawCh = mm[1];
      }
      if (!rawCh) return;
      const ch = rawCh.toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(MORSE_CODE, ch)) return;
      e.preventDefault();
      morseQueue.push(ch);
      startMorse();
    });

    // ---------- 広い画面の並べ方（本体とダイヤルを横並び）と、モールスのキーボード ----------
    (function () {
      const body = document.body;
      const ctrl1 = document.getElementById('ctrlRow1'), ctrl2 = document.getElementById('ctrlRow2');
      const headerBtns = document.getElementById('headerBtns'), tuneActions = document.getElementById('tuneActions');
      let wideNow = null;
      function layoutWide() {
        const need = window.innerWidth >= (body.classList.contains('diag-on') ? 1100 : 1000);
        if (need === wideNow) return;
        wideNow = need;
        body.classList.toggle('wide', need);
        if (typeof placeHomeControls === 'function') placeHomeControls();
        const rb = document.getElementById('reconnectBtn'), lb = document.getElementById('leaveBtn');
        const sb = document.getElementById('shareBtn'), qb = document.getElementById('qrBtn'), sp = document.getElementById('speakerBtn');
        if (need) { ctrl1.appendChild(rb); ctrl1.appendChild(lb); ctrl2.appendChild(sb); ctrl2.appendChild(qb); ctrl2.appendChild(sp); }
        else { headerBtns.appendChild(rb); headerBtns.appendChild(lb); tuneActions.appendChild(sb); tuneActions.appendChild(qb); tuneActions.appendChild(sp); }
      }
      window.addEventListener('resize', layoutWide);
      new MutationObserver(function () { layoutWide(); }).observe(body, { attributes: true, attributeFilter: ['class'] });
      layoutWide();

      // モールスのキーボード（スマホ）。スペースは付けない
      const drawer = document.getElementById('morseDrawer'), handle = document.getElementById('morseHandle'), kb = document.getElementById('morseBody'), qv = document.getElementById('morseQueueView');
      const rows = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM', '.,?!/-:'];
      rows.forEach(function (r, ri) {
        const row = document.createElement('div'); row.className = 'mk-row';
        if (ri === 3) { const e = document.createElement('button'); e.type = 'button'; e.className = 'mk wide'; e.textContent = 'ESC'; e.dataset.k = 'ESC'; row.appendChild(e); }
        r.split('').forEach(function (c) { const b = document.createElement('button'); b.type = 'button'; b.className = 'mk'; b.textContent = c; b.dataset.k = c; row.appendChild(b); });
        if (ri === 3) { const d = document.createElement('button'); d.type = 'button'; d.className = 'mk wide'; d.textContent = '⌫'; d.dataset.k = 'BS'; row.appendChild(d); }
        kb.appendChild(row);
      });
      handle.addEventListener('click', function () { const o = drawer.classList.toggle('open'); handle.setAttribute('aria-expanded', o ? 'true' : 'false'); document.getElementById('morseToggle').textContent = o ? '▼ 閉じる' : '▲ 開く'; });
      kb.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('.mk')) e.preventDefault(); }); // 入力欄のフォーカスを奪わない
      kb.addEventListener('click', function (e) {
        const b = e.target.closest ? e.target.closest('.mk') : null;
        if (!b || !currentKey || !room) return;
        const k = b.dataset.k;
        if (k === 'ESC') { if (faxMode) exitFaxMode(); faxCanvas.classList.add('hidden'); morseQueue.push('E', 'S', 'C'); startMorse(); return; }
        if (k === 'BS') { if (morseQueue.length) morseQueue.pop(); return; }
        if (!Object.prototype.hasOwnProperty.call(MORSE_CODE, k)) return;
        morseQueue.push(k); startMorse();
      });
      setInterval(function () { if (drawer.classList.contains('hidden')) return; const t = morseQueue.join('').trim(); qv.textContent = t ? '送信待ち ' + t : ''; }, 250);
    })();


    // スマホ: 左端の帯でダイヤルのドロワーを開く。外側を押すか、部屋に入ると、閉じる
    (function () {
      const tab = document.getElementById('dialTab'), scrim = document.getElementById('dialScrim');
      function setOpen(o) { document.body.classList.toggle('dial-open', o); tab.setAttribute('aria-expanded', o ? 'true' : 'false'); }
      tab.addEventListener('click', function () { setOpen(!document.body.classList.contains('dial-open')); });
      document.getElementById('dialCloseTab').addEventListener('click', function () { setOpen(false); });
      scrim.addEventListener('click', function () { setOpen(false); });
      window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('dial-open')) { e.stopPropagation(); setOpen(false); } }, true);
      window.closeDialDrawer = function () { setOpen(false); };
    })();

    // iPhone: 入力欄をタップしてキーボードが出たあと、ページの位置が、ずれたまま戻らなくなることがある。収まっているページは、いつも一番上に戻す
    (function () {
      function resetIfFits() {
        const de = document.documentElement;
        if (de.scrollHeight <= window.innerHeight + 4 && window.scrollY !== 0) window.scrollTo(0, 0);
      }
      document.addEventListener('focusout', function (e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) { setTimeout(resetIfFits, 60); setTimeout(resetIfFits, 400); }
      });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { setTimeout(resetIfFits, 60); });
    })();

    // ---------- モールス受信（700Hzトーンを検出して文字に戻す） ----------
    const MORSE_REVERSE = {};
    Object.keys(MORSE_CODE).forEach(function (k) { MORSE_REVERSE[MORSE_CODE[k]] = k; });
    const rxDecoders = new Map(); // peerId -> 復号の状態
    function resetRxDecode(peerId) {
      const d = rxDecoders.get(peerId);
      if (d) { d.pat = ''; d.text = ''; d.tone = false; d.hasPend = false; d.pendDur = 0; d.letterDone = false; d.wordDone = false; }
    }
    function morseDist1(a, b) { // 2つの符号が「1要素だけ違う」か
      if (a === b) return false;
      const la = a.length, lb = b.length;
      if (Math.abs(la - lb) > 1) return false;
      if (la === lb) {
        let diff = 0;
        for (let i = 0; i < la; i++) if (a[i] !== b[i]) diff++;
        return diff === 1;
      }
      const s = la < lb ? a : b, l = la < lb ? b : a;
      let i = 0, j = 0, skipped = false;
      while (i < s.length && j < l.length) {
        if (s[i] === l[j]) { i++; j++; }
        else { if (skipped) return false; skipped = true; j++; }
      }
      return true;
    }
    function flushRxChar(d) {
      if (!d.pat) return;
      const hit = MORSE_REVERSE[d.pat];
      if (hit) { d.text += hit; }
      else {
        // 完全一致が無くても、1要素違いの候補が1つだけなら推定して読む
        let cand = null, ties = 0;
        Object.keys(MORSE_REVERSE).forEach(function (p) {
          if (morseDist1(d.pat, p)) { cand = MORSE_REVERSE[p]; ties++; }
        });
        if (ties === 1) d.text += /[A-Z]/.test(cand) ? cand.toLowerCase() : cand + '?'; // 推定は目印付き
        else d.text += '[' + d.pat.split('').map(function (c) { return c === '.' ? '・' : '−'; }).join('') + ']'; // 読めなかった符号は測れた形のまま出す
      }
      d.text = d.text.slice(-60);
      if (d.text.slice(-3) === 'ESC') faxCanvas.classList.add('hidden'); // 「ESC」を受けたら紙を隠す
      d.pat = '';
    }
    function flushRxDecode(peerId) {
      const d = rxDecoders.get(peerId);
      if (!d || d.tone) return; // トーンの途中で確定すると末尾が欠けるので、終わってからだけ
      finalizePend(peerId);
      if (d.pat) { flushRxChar(d); renderRxDecode(peerId); }
    }
    function renderRxDecode(peerId) {
      const d = rxDecoders.get(peerId);
      if (!d) return;
      let s = d.text;
      let cur = d.pat;
      if (d.hasPend) cur += d.pendDur < MORSE_UNIT_MS * 2 ? '.' : '-';
      if (cur) s += (s ? ' ' : '') + cur.split('').map(function (c) { return c === '.' ? '・' : '−'; }).join('');
      lcdSub.textContent = s.length > 38 ? s.slice(-38) : s; // 表題なし・長いときは最新だけ見せる
    }
    function finalizePend(peerId) {
      const d = rxDecoders.get(peerId);
      if (!d || !d.hasPend) return;
      d.pat += d.pendDur < MORSE_UNIT_MS * 2 ? '.' : '-';
      d.hasPend = false; d.pendDur = 0;
      d.offAt = d.pendEnd;
      renderRxDecode(peerId);
    }
    setInterval(function () { decodeMorseRx(); decodeFaxRx(); }, 15); // 描画と切り離して一定間隔で測る（先頭の符号を取りこぼさないため）
    function freqQuiet(freq) {
      for (let i = 0; i < freq.length; i++) { if (freq[i] > 10) return false; }
      return true;
    }
    function decodeMorseRx() {
      const now = performance.now();
      rxDecoders.forEach(function (d, peerId) {
        const an = d.an;
        an.getByteFrequencyData(d.freq);
        // 無音のときは、重い計算を飛ばす（相手が7人いても、パソコンの負荷を抑える）。保留中の符号があるときは、続ける
        if (!d.tone && !d.hasPend && !d.pat && !(d.letterDone && !d.wordDone) && freqQuiet(d.freq)) { d.dbg = null; return; }
        const binHz = an.context.sampleRate / an.fftSize;
        const idx = Math.round(700 / binHz);
        let peak = 0;
        for (let i = idx - 2; i <= idx + 2; i++) { if (d.freq[i] > peak) peak = d.freq[i]; }
        let sum = 0, cnt = 0;
        for (let i = 2; i < d.freq.length; i++) { if (Math.abs(i - idx) > 3) { sum += d.freq[i]; cnt++; } }
        const avg = cnt ? sum / cnt : 0;
        // 肉声は帯域全体に散るのでモールスとして受け取らない（純音は700Hz帯に集中する）
        function bandEnergy(fromHz, toHz) {
          let e = 0;
          const a = Math.max(1, Math.floor(fromHz / binHz)), b = Math.min(d.freq.length - 1, Math.ceil(toHz / binHz));
          for (let i = a; i <= b; i++) { const db = -100 + (d.freq[i] / 255) * 70; const amp = Math.pow(10, db / 20); e += amp * amp; }
          return e;
        }
        const eVoice = bandEnergy(100, 4000);
        const pure = eVoice > 0 && bandEnergy(620, 780) / eVoice >= 0.55;
        const floor = d.tone ? 70 : 100;
        const isTone = peak >= floor && peak > avg * 3 && pure;
        d.dbg = { peak: peak, avg: Math.round(avg), pure: eVoice > 0 ? Math.round(bandEnergy(620, 780) / eVoice * 100) : 0, tone: isTone, sr: an.context.sampleRate, at: now }; // 診断画面用
        if (peak >= 30 && (!d.dbgLast || peak >= d.dbgLast.peak || now - d.dbgLast.at > 8000)) d.dbgLast = d.dbg; // 直近で、いちばん強かった音を残す
        if (isTone) {
          if (!d.tone) {
            d.tone = true; d.toneAt = now;
            if (d.hasPend && now - d.pendEnd >= 30) finalizePend(peerId); // 30ms以上あいたら前の符号は確定
            // 次の符号の始まりで、前の文字との区切りを実測の無音長で確定する
            if (!d.hasPend && d.offAt && (d.pat || d.letterDone) && !d.wordDone) {
              const gap = now - d.offAt;
              if (gap >= MORSE_UNIT_MS * 5) {
                if (d.pat) flushRxChar(d);
                d.text = (d.text + ' ').slice(-60);
                renderRxDecode(peerId);
              }
              else if (d.pat && gap >= MORSE_UNIT_MS * 2 + 5) { flushRxChar(d); renderRxDecode(peerId); }
            }
            d.letterDone = false; d.wordDone = false;
          }
        } else {
          if (d.tone) {
            d.tone = false;
            const seg = now - d.toneAt;
            if (seg >= 35) { // 35ms未満のクリック等のノイズは捨てる
              if (d.hasPend) d.pendDur += (d.toneAt - d.pendEnd) + seg; // 短い欠落はつないで1つの符号にする
              else { d.pendDur = seg; d.hasPend = true; }
              d.pendEnd = now;
            }
          }
          if (d.hasPend && now - d.pendEnd >= 30) finalizePend(peerId);
          if (!d.hasPend && (d.pat || (d.letterDone && !d.wordDone))) {
            const silence = now - d.offAt;
            if (silence >= MORSE_UNIT_MS * 5 && !d.wordDone) {
              if (d.pat) flushRxChar(d);
              d.text = (d.text + ' ').slice(-60);
              d.wordDone = true; d.letterDone = true;
              renderRxDecode(peerId);
            } else if (d.pat && silence >= MORSE_UNIT_MS * 2 + 5 && !d.letterDone) {
              flushRxChar(d);
              d.letterDone = true;
              renderRxDecode(peerId);
            }
          }
        }
      });
    }


    // ---------- FAXモード（隠し: 「fax」と打つと入る / ESCで解除） ----------
    const FAX_ROWS = 15, FAX_COLS = 240, FAX_PX_MS = 20; // 紙は15行: 先頭の空行1 + 本文14行（1行分だけ）。画素は回線で潰れない太さに
    const FAX_TEXT_ROWS = 14;
    const FAX_FREQ = { pre: 1500, sync: 900, white: 1300, black: 2100 };
    let faxMode = false, faxText = '', faxProbe = '';
    let faxTxActive = false, faxPlaying = false, faxSession = 0;
    const faxCanvas = document.getElementById('faxCanvas');
    const faxCtx2d = faxCanvas.getContext('2d');
    const faxImg = faxCtx2d.createImageData(FAX_COLS, FAX_ROWS);
    function faxFillPaper() {
      for (let i = 0; i < faxImg.data.length; i += 4) {
        faxImg.data[i] = 248; faxImg.data[i + 1] = 248; faxImg.data[i + 2] = 240; faxImg.data[i + 3] = 255;
      }
      faxCtx2d.putImageData(faxImg, 0, 0);
    }
    function faxDrawPixel(x, y, black) {
      if (x < 0 || x >= FAX_COLS || y < 0 || y >= FAX_ROWS) return;
      const i = (y * FAX_COLS + x) * 4;
      faxImg.data[i] = black ? 20 : 248;
      faxImg.data[i + 1] = black ? 20 : 248;
      faxImg.data[i + 2] = black ? 20 : 240;
      faxImg.data[i + 3] = 255;
    }
    function renderFaxCompose() {
      lcdSub.textContent = faxText ? faxText + '▌' : 'FAXモード: 文字を打って Enter で送信（ESCで終了）';
    }
    function enterFaxMode() {
      abortMorse();
      faxMode = true;
      faxText = '';
      faxCanvas.classList.remove('hidden');
      faxFillPaper();
      renderFaxCompose();
    }
    function exitFaxMode() {
      if (faxTxActive) abortFax();
      faxMode = false;
      faxText = '';
      flashSub('FAXモード終了');
    }
    function textToFaxGrid(text) {
      const c = document.createElement('canvas');
      const g = c.getContext('2d', { willReadFrequently: true });
      const FS = 56; // 大きく描いてから縮小する（小さい字を直接潰すと線が欠けるので）
      const H = 84; // 上下に余裕を持たせ、g のような下へ伸びる字も切らない
      g.font = '700 ' + FS + 'px monospace';
      const w = Math.max(1, Math.ceil(g.measureText(text).width)) + 4;
      c.width = w; c.height = H;
      g.font = '700 ' + FS + 'px monospace';
      g.fillStyle = '#000';
      g.textBaseline = 'alphabetic';
      g.fillText(text, 2, FS);
      const src = g.getImageData(0, 0, w, H).data;
      // インクのある範囲を実測して、その範囲だけを14行に写す（字の位置決めをフォント任せにしない）
      let minX = w, maxX = -1, minY = H, maxY = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
        if (src[(y * w + x) * 4 + 3] > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      const grid = [];
      if (maxX < 0) {
        for (let y = 0; y < FAX_TEXT_ROWS; y++) grid.push([0]);
        return grid;
      }
      const iw = maxX - minX + 1, ih = maxY - minY + 1;
      const cols = Math.max(1, Math.min(FAX_COLS, Math.round(iw * FAX_TEXT_ROWS / ih)));
      for (let y = 0; y < FAX_TEXT_ROWS; y++) {
        const row = [];
        const sy0 = minY + Math.floor(y * ih / FAX_TEXT_ROWS), sy1 = Math.min(maxY + 1, Math.max(sy0 + 1, minY + Math.floor((y + 1) * ih / FAX_TEXT_ROWS)));
        for (let x = 0; x < cols; x++) {
          const sx0 = minX + Math.floor(x * iw / cols), sx1 = Math.min(maxX + 1, Math.max(sx0 + 1, minX + Math.floor((x + 1) * iw / cols)));
          let ink = 0, tot = 0;
          for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
            if (src[(sy * w + sx) * 4 + 3] > 100) ink++;
            tot++;
          }
          row.push(tot && ink / tot > 0.2 ? 1 : 0); // 細い線も残す（Macのフォントは線が細く、厳しく切ると欠ける）
        }
        grid.push(row);
      }
      return grid;
    }
    function faxTone(freq, ms) {
      return new Promise(function (resolve) {
        if (!faxOsc) { resolve(); return; }
        const t = getAudioContext().currentTime;
        faxOsc.frequency.cancelScheduledValues(t);
        faxOsc.frequency.setTargetAtTime(freq, t, 0.002);
        setTimeout(resolve, ms);
      });
    }
    function beginFaxTx() {
      faxTxActive = true;
      isTransmitting = true;
      if (micSendGain) micSendGain.gain.value = 0;
      if (localAudioTrack) localAudioTrack.enabled = true;
      if (faxGain) faxGain.gain.setTargetAtTime(0.2, getAudioContext().currentTime, 0.005);
      ledTx.classList.add('active');
      statusLabel.textContent = 'TX (FAX送信中)';
      statusLabel.style.color = 'var(--tx-color)';
      renderPeers();
      if (sendPttState) sendPttState({ isTalking: true });
      announce();
    }
    function finishFaxTx() {
      if (faxGain) faxGain.gain.setTargetAtTime(0, getAudioContext().currentTime, 0.005);
      faxTxActive = false;
      isTransmitting = false;
      if (micSendGain) micSendGain.gain.value = 1;
      if (localAudioTrack) localAudioTrack.enabled = false;
      ledTx.classList.remove('active');
      statusLabel.textContent = 'STANDBY';
      statusLabel.style.color = '';
      renderPeers();
      if (sendPttState) sendPttState({ isTalking: false });
      announce();
      if (faxMode) renderFaxCompose();
    }
    function abortFax() {
      faxSession++;
      faxPlaying = false;
      if (faxTxActive) finishFaxTx();
      if (faxGain) faxGain.gain.value = 0;
    }
    async function startFaxTx() {
      if (faxPlaying || !faxText) return;
      if (!room || isTransmitting) return;
      if (othersTalking() > 0) { playBusyTone(); flashSub('話中です'); return; }
      faxPlaying = true;
      const ok = await initMicrophone();
      if (!ok) { faxPlaying = false; flashSub('マイクの許可が必要です'); return; }
      if (!room || othersTalking() > 0) { faxPlaying = false; return; }
      const session = ++faxSession;
      let grid;
      try { grid = textToFaxGrid(faxText); } catch (_) { faxPlaying = false; flashSub('FAX化に失敗しました'); return; }
      faxCanvas.classList.remove('hidden');
      faxFillPaper();
      beginFaxTx();
      if (sendFaxPage) { try { sendFaxPage(faxGridToPayload(grid)); } catch (_) {} } // 中身はデータ便でも先に送る（表示は音に合わせて後から）
      await morseSleep(500);
      if (session !== faxSession) { faxPlaying = false; return; }
      await faxTone(FAX_FREQ.pre, 700); // ピー（受信開始の合図）: 受信側が確実に拾えるよう長めに
      async function sendFaxRow(rowArr, cols, yAbs) {
        if (session !== faxSession) return;
        await faxTone(FAX_FREQ.sync, 150);
        let hasBlack = false;
        if (rowArr) for (let i = 0; i < cols; i++) if (rowArr[i]) { hasBlack = true; break; }
        if (!hasBlack) { await faxTone(FAX_FREQ.white, 80); return; } // 空行は短く送る（中身が無いので時間は要らない）
        let x = 0;
        while (x < cols && session === faxSession) {
          let x2 = x + 1;
          while (x2 < cols && rowArr[x2] === rowArr[x]) x2++;
          await faxTone(rowArr[x] ? FAX_FREQ.black : FAX_FREQ.white, (x2 - x) * FAX_PX_MS);
          for (let px = x; px < x2; px++) faxDrawPixel(px, yAbs, !!rowArr[px]);
          faxCtx2d.putImageData(faxImg, 0, 0);
          x = x2;
        }
      }
      await sendFaxRow(null, 0, 0); // 先頭の空行（余白）
      for (let y = 0; y < FAX_TEXT_ROWS && session === faxSession; y++) {
        await sendFaxRow(grid[y], grid[0].length, 1 + y);
      }
      faxPlaying = false;
      if (session === faxSession) { await morseSleep(150); finishFaxTx(); }
    }
    // ---------- FAX受信 ----------
    const faxDecoders = new Map();
    function faxBandEnergy(srcD, freq) {
      const binHz = srcD.an.context.sampleRate / srcD.an.fftSize;
      const idx = Math.round(freq / binHz);
      let e = 0;
      for (let i = idx - 1; i <= idx + 1; i++) {
        if (i < 0 || i >= srcD.freq.length) continue;
        const db = -100 + (srcD.freq[i] / 255) * 70;
        const amp = Math.pow(10, db / 20);
        e += amp * amp;
      }
      return e;
    }
    function decodeFaxRx() {
      const now = performance.now();
      rxDecoders.forEach(function (srcD, peerId) {
        let d = faxDecoders.get(peerId);
        if (!d) { d = { state: 'idle', preCount: 0, row: 0, lastX: -1, lastAct: 0, rowStart: 0, syncStart: 0 }; faxDecoders.set(peerId, d); }
        srcD.an.getByteFrequencyData(srcD.freq);
        if (d.state === 'idle' && freqQuiet(srcD.freq)) { d.preCount = 0; return; }
        const ePre = faxBandEnergy(srcD, FAX_FREQ.pre), eSync = faxBandEnergy(srcD, FAX_FREQ.sync);
        const eW = faxBandEnergy(srcD, FAX_FREQ.white), eB = faxBandEnergy(srcD, FAX_FREQ.black);
        const total = ePre + eSync + eW + eB;
        let kind = '';
        if (total > 0.000001) {
          const m = Math.max(ePre, eSync, eW, eB);
          if (m / total >= 0.5) kind = m === ePre ? 'pre' : m === eSync ? 'sync' : m === eW ? 'white' : 'black';
        }
        if (d.state === 'idle') {
          if (kind === 'pre') {
            if (++d.preCount >= 8) {
              d.state = 'armed'; d.row = 0; d.lastAct = now;
              const dig = faxDigital.get(peerId);
              if (dig && !dig.started) startFaxReveal(peerId, 500); // デジタル便が来ていれば、音に合わせて表示開始
              else if (!dig) { faxCanvas.classList.remove('hidden'); faxFillPaper(); }
            }
          } else d.preCount = 0;
          return;
        }
        if (kind) d.lastAct = now;
        if (now - d.lastAct > 900) { d.state = 'idle'; d.preCount = 0; return; }
        if (d.state === 'armed') {
          if (kind === 'sync') { d.state = 'insync'; d.syncStart = now; }
        } else if (d.state === 'insync') {
          if (kind !== 'sync') { d.state = 'row'; d.rowStart = now; d.lastX = -1; } // 同期の終わりを実測して行の起点にする
          else if (now - d.syncStart > 320) { d.state = 'row'; d.rowStart = now; d.lastX = -1; }
        } else if (d.state === 'row') {
          if (kind === 'sync' && now - d.rowStart > 60) {
            d.row++;
            if (d.row >= FAX_ROWS) { d.state = 'idle'; d.preCount = 0; return; }
            d.state = 'insync'; d.syncStart = now;
          } else if (kind === 'white' || kind === 'black') {
            const dig2 = faxDigital.get(peerId);
            if (dig2 && dig2.started) return; // デジタル表示中はアナログで上書きしない
            const x = Math.floor((now - d.rowStart) / FAX_PX_MS);
            const from = d.lastX < 0 ? 0 : d.lastX + 1;
            const to = Math.min(x, FAX_COLS - 1);
            for (let px = from; px <= to; px++) faxDrawPixel(px, d.row, kind === 'black');
            if (x !== d.lastX) { faxCtx2d.putImageData(faxImg, 0, 0); d.lastX = x; }
          }
        }
      });
    }


    // ---------- FAXデジタル便（中身はデータで確実に届け、見せ方は音のFAXのまま） ----------
    const faxDigital = new Map(); // peerId -> { grid, timers, started }
    function faxGridToPayload(grid) {
      const cols = grid[0].length;
      let bin = '';
      for (let y = 0; y < grid.length; y++) {
        for (let b = 0; b < Math.ceil(cols / 8); b++) {
          let v = 0;
          for (let bit = 0; bit < 8; bit++) {
            const x = b * 8 + bit;
            if (x < cols && grid[y][x]) v |= (1 << (7 - bit));
          }
          bin += String.fromCharCode(v);
        }
      }
      return { c: cols, d: btoa(bin) };
    }
    function faxPayloadToGrid(p) {
      if (!p || typeof p.c !== 'number' || typeof p.d !== 'string') return null;
      const cols = Math.max(1, Math.min(FAX_COLS, p.c));
      let bin;
      try { bin = atob(p.d); } catch (_) { return null; }
      const bpr = Math.ceil(cols / 8);
      if (bin.length < bpr * FAX_TEXT_ROWS) return null;
      const grid = [];
      for (let y = 0; y < FAX_TEXT_ROWS; y++) {
        const row = [];
        for (let x = 0; x < cols; x++) {
          row.push((bin.charCodeAt(y * bpr + Math.floor(x / 8)) >> (7 - (x % 8))) & 1);
        }
        grid.push(row);
      }
      return grid;
    }
    function cancelFaxReveal(peerId) {
      const st = faxDigital.get(peerId);
      if (st) st.timers.forEach(function (t) { clearTimeout(t); });
      faxDigital.delete(peerId);
    }
    function startFaxReveal(peerId, delayMs) {
      const st = faxDigital.get(peerId);
      if (!st || st.started) return;
      st.started = true;
      faxCanvas.classList.remove('hidden');
      faxFillPaper();
      // 送信側と同じ進行表で1行ずつ出す: 空行（同期+短い白）→ 本文行（同期+幅ぶん）。真っ白な行は速い
      const cols = st.grid[0].length;
      let at = delayMs || 0;
      function scheduleRow(rowArr, yAbs, dur) {
        const t = setTimeout(function () {
          if (faxDigital.get(peerId) !== st) return;
          if (rowArr) for (let x = 0; x < cols; x++) faxDrawPixel(x, yAbs, !!rowArr[x]);
          faxCtx2d.putImageData(faxImg, 0, 0);
        }, at);
        st.timers.push(t);
        at += dur;
      }
      scheduleRow(null, 0, 150 + 80);
      for (let y = 0; y < FAX_TEXT_ROWS; y++) {
        const rowArr = st.grid[y];
        const blank = !rowArr.some(function (v) { return v; });
        scheduleRow(rowArr, 1 + y, blank ? 150 + 80 : 150 + cols * FAX_PX_MS);
      }
      const done = setTimeout(function () { if (faxDigital.get(peerId) === st) faxDigital.delete(peerId); }, at + 4000);
      st.timers.push(done);
    }
    function onFaxPage(data, peerId) {
      if (POCHI_NATIVE && data) { try { window.webkit.messageHandlers.pochi.postMessage({ type: 'fax', peerId: peerId, c: data.c, d: data.d }); } catch (_) {} }
      const grid = faxPayloadToGrid(data);
      if (!grid) return;
      cancelFaxReveal(peerId);
      const st = { grid: grid, timers: [], started: false };
      faxDigital.set(peerId, st);
      // 音の合図（ピー）が聞こえればそちらで開始。聞こえなくても少し待って開始する
      st.timers.push(setTimeout(function () { startFaxReveal(peerId, 0); }, 1500));
    }


    // ---------- ネイティブアプリ連携ブリッジ（?native=1 のときだけ有効） ----------
    const POCHI_NATIVE = new URLSearchParams(location.search).has('native');
    if (POCHI_NATIVE) {
      try { if (welcomeDialog.open) welcomeDialog.close(); } catch (_) {}
      const pochiPost = function (obj) {
        try { window.webkit.messageHandlers.pochi.postMessage(obj); } catch (_) {}
      };
      const pochiLevelOf = function (an) {
        if (!an) return 0;
        const buf = new Uint8Array(an.fftSize);
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) { const d = Math.abs(buf[i] - 128) / 128; if (d > peak) peak = d; }
        return Math.round(peak * 1000) / 1000;
      };
      const pochiSnapshot = function () {
        const rooms = [];
        roomStats().forEach(function (st, key) {
          rooms.push({ key: key, hash: fmt(key), count: st.count, air: !!st.air, names: st.names, tag: st.tag || '', tagBy: st.tagBy || '' });
        });
        rooms.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
        const peers = [];
        if (currentKey) {
          peers.push({ id: 'me', name: myNickname, me: true, talking: !!isTransmitting });
          peerMap.forEach(function (p, id) { peers.push({ id: id, name: p.name || '相手', me: false, talking: !!p.isTalking }); });
        }
        let morse = '';
        rxDecoders.forEach(function (d) { if (d.text) morse = d.text; });
        return {
          type: 'state', name: myNickname,
          inRoom: !!currentKey, roomKey: currentKey || '', roomHash: currentKey ? fmt(currentKey) : '',
          tag: roomMeta.tag || '', tagBy: roomMeta.by || '',
          peers: peers, rooms: rooms,
          meTalking: !!isTransmitting, talkerId: currentTalkerId || '',
          morseRx: morse, faxMode: !!faxMode,
          settings: { inputDb: inputDb, vox: !!voxCheck.checked, voxSens: parseInt(voxSens.value, 10) || 5, sfxVol: Math.round(sfxVol * 100), speakerMuted: !!speakerMuted }
        };
      };
      let pochiLastJSON = '';
      setInterval(function () {
        const s = pochiSnapshot();
        const j = JSON.stringify(s);
        if (j !== pochiLastJSON) { pochiLastJSON = j; pochiPost(s); }
      }, 400);
      setInterval(function () {
        if (!currentKey) return;
        let rx = 0;
        const an = currentTalkerId ? rxAnalysers.get(currentTalkerId) : null;
        if (an) rx = pochiLevelOf(an);
        pochiPost({ type: 'level', tx: pochiLevelOf(txAnalyser), rx: rx });
      }, 150);
      window.__pochiCmd = function (json) {
        let cmd = null;
        try { cmd = JSON.parse(json); } catch (_) { return; }
        if (!cmd || !cmd.cmd) return;
        try {
          if (cmd.cmd === 'join' && cmd.name) hashOf(String(cmd.name)).then(function (k) { tuneKey(k); });
          else if (cmd.cmd === 'joinKey' && cmd.key) tuneKey(String(cmd.key).toLowerCase());
          else if (cmd.cmd === 'leave') leaveRoom();
          else if (cmd.cmd === 'reconnect') reconnectRoom(false);
          else if (cmd.cmd === 'pttDown') press();
          else if (cmd.cmd === 'pttUp') release();
          else if (cmd.cmd === 'setName') {
            const v = String(cmd.name || '').trim().slice(0, 20) || 'NoName';
            myNickname = v;
            nameInput.value = v;
            try { localStorage.setItem('pochitalk_ptt_name', v); } catch (_) {}
            if (sendNickname) sendNickname(v);
            announce();
          }
          else if (cmd.cmd === 'setTag') setTag(String(cmd.tag || ''));
          else if (cmd.cmd === 'morse') {
            const text = String(cmd.text || '').toUpperCase();
            for (let i = 0; i < text.length; i++) {
              const ch = text[i];
              if (ch === ' ') { if (morsePlaying || morseQueue.length) morseQueue.push(' '); }
              else if (Object.prototype.hasOwnProperty.call(MORSE_CODE, ch)) morseQueue.push(ch);
            }
            startMorse();
          }
          else if (cmd.cmd === 'esc') {
            if (faxMode) exitFaxMode();
            faxCanvas.classList.add('hidden');
            morseQueue.push('E', 'S', 'C');
            startMorse();
          }
          else if (cmd.cmd === 'fax') { faxText = String(cmd.text || '').slice(0, 24); if (faxText) startFaxTx(); }
          else if (cmd.cmd === 'settings') {
            const s = cmd.settings || {};
            if (typeof s.inputDb === 'number') setInputDb(s.inputDb, true);
            if (typeof s.voxSens === 'number') {
              voxSens.value = String(Math.min(10, Math.max(1, s.voxSens)));
              updateVoxThrMarker();
              try { localStorage.setItem('pochitalk_vox_thr', voxSens.value); } catch (_) {}
            }
            if (typeof s.vox === 'boolean') {
              if (s.vox && !voxCheck.checked) { setVoxUI(true); startVox(); }
              else if (!s.vox && voxCheck.checked) { setVoxUI(false); stopVox(); }
            }
            if (typeof s.sfxVol === 'number') {
              sfxVol = Math.min(1.5, Math.max(0, s.sfxVol / 100));
              if (sfxGainNode) sfxGainNode.gain.value = speakerMuted ? 0 : sfxVol;
              try { localStorage.setItem('pochitalk_sfx_vol', String(Math.round(sfxVol * 100))); } catch (_) {}
            }
            if (typeof s.speakerMuted === 'boolean') { speakerMuted = s.speakerMuted; applySpeakerMute(); }
          }
          else if (cmd.cmd === 'ping') { pochiLastJSON = ''; }
        } catch (_) {}
      };
      pochiPost({ type: 'ready' });
    }



    // ---------- 部屋(ハッシュ周波数)操作 ----------
    let pendingKey = null; // 招待URLで指定された部屋（まだ入室していない）
    let scrolledForKey = null; // 入室したとき、本体が画面の外にあれば、自動で本体までスクロールする（スマホ用）
    function renderFreq(key) {
      if (key && window.closeDialDrawer) window.closeDialDrawer();
      if (!key) scrolledForKey = null;
      else if (scrolledForKey !== key) {
        scrolledForKey = key;
        setTimeout(function () {
          const r = document.getElementById('radioView').getBoundingClientRect();
          if (r.top < 0 || r.top > window.innerHeight * 0.4) document.getElementById('radioView').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      }
      document.getElementById('homeView').classList.toggle('hidden', !!key);
      document.getElementById('homeCard').classList.toggle('hidden', !!key);
      document.getElementById('radioView').classList.toggle('idle', !key);
      setPttLabel(key);
      placeHomeControls();
      document.getElementById('ctrlCard').classList.toggle('hidden', !key);
      document.getElementById('morseDrawer').classList.toggle('hidden', !key);
      if (!key) document.getElementById('stickyBar').classList.add('hidden');
      if (!key) { resetFlip(); return; }
      roomDisplay.textContent = fmt(key);
      chDisplay.textContent = 'ROOM HASH';
      freqDisplay.textContent = fmt(key);
      freqDisplay.classList.remove('tuning');
      lcdSub.textContent = '';
    }

    function leaveRoom() {
      if (isTransmitting) { pressed = false; stopTransmission(); }
      if (voxCheck.checked) { setVoxUI(false); stopVox(); }
      if (room) { const old = room; room = null; closeOldConnections(old); }
      releaseMic();
      sendPttState = null; sendNickname = null; sendJoinAge = null; sendTag = null; sendFaxPage = null;
      peerMap.clear();
      currentTalkerId = null;
      document.querySelectorAll('audio[id^="audio-"]').forEach(function (a) { a.remove(); });
      ledRx.classList.remove('active');
      statusLabel.textContent = 'STANDBY';
      statusLabel.style.color = '#38bdf8';
      currentKey = null;
      try { history.replaceState(null, '', location.pathname); } catch (_) {}
      renderPeers();
      renderFreq(null);
      renderScan();
    }

    function flashSub(text) {
      lcdSub.textContent = text;
      clearTimeout(flashSub.t);
      flashSub.t = setTimeout(function () { renderFreq(currentKey); }, 2500);
    }

    function tuneKey(key) {
      if (isTransmitting) { flashSub('送信中は周波数を変えられません'); return; }
      if (key !== currentKey) {
        const st0 = roomStats().get(key);
        if (st0 && st0.count >= MAX_ROOM) { toast('この部屋は満員です（' + MAX_ROOM + '人まで）'); return; }
      }
      if (key === currentKey) { renderFreq(key); flashSub('すでにこの周波数です'); return; }
      currentKey = key;
      pendingKey = null;
      resetFlip();
      try { history.replaceState(null, '', '?r=' + key); } catch (_) {}
      freqDisplay.classList.add('tuning');
      let i = 0;
      const t = setInterval(function () {
        if (++i >= 9) { clearInterval(t); renderFreq(currentKey); return; }
        freqDisplay.textContent = fmt(toHex(crypto.getRandomValues(new Uint8Array(4))));
      }, 45);
      endMicTest();
      // TURN の資格情報が取れる前に入ると、その部屋にいる間ずっと直接接続（中継なし）のままになるので、少しだけ待つ（最長 4 秒）
      const keyNow = currentKey;
      const ready = iceFetchedAt > 0 ? Promise.resolve() : Promise.race([refreshIceServers(), new Promise(function (r) { setTimeout(r, 4000); })]);
      ready.then(function () { if (currentKey === keyNow) connectToChannel(keyNow); });
      renderPeers();
      // 入室のタップ操作の中でマイクの許可を求める（許可されなければ、話すときにもう一度確認する）
      initMicrophone(true).then(function (ok) {
        if (!ok && room && !userMediaStream) flashSub('マイクが許可されていません。話すときに再度確認します');
      });
      announce();
      renderScan();
    }

    // ---------- ロビー: 各部屋の在室状況を共有 ----------
    // 部屋の一覧は、WebRTC（アプリを開いている全員と接続）ではなく、Nostr のリレーに、在室の知らせを直接送って共有する。
    // 全員とつなぐ方式は、人が増えたり、TURN 中継固定だったりすると、接続の準備が溜まって、一覧が共有されなくなるため。
    // ---------- 部屋の人数の上限（1つの部屋は8人まで）----------
    // 通話は、全員が全員と直接つながる方式なので、人数が増えると、各端末の負荷が急に重くなる。そのため、上限を設ける。
    // ・入る前: 一覧の人数が上限なら、入れない
    // ・入ったあと（同時に入って超えたとき）: 入室が新しい人から、上限を超えた分が、自分で退出する（古い人は、追い出されない）
    const MAX_ROOM = 8;
    // おうむ返しボットの部屋は、特別扱い: タグは固定で、誰も書き換えられない。一覧では、いつも先頭に出す
    const BOT_ROOM_KEY = '7a0b07c1';
    const BOT_ROOM_TAG = '🦜 おうむ返しの部屋（話すと、あなたにだけ声が返ります）';
    function isBotRoom(k) { return k === BOT_ROOM_KEY; }
    let toastTimer = null;
    function toast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 3500);
    }
    function checkRoomFull() {
      if (!currentKey || !room) return;
      if (peerMap.size + 1 <= MAX_ROOM) return;
      const members = [{ id: 'me', t: roomEnterTime }];
      peerMap.forEach(function (p, id) { members.push({ id: id, t: p.enteredAt || 0 }); }); // 入室時刻が分からない相手（古い版など）は、古株として扱う
      members.sort(function (a, b) { return a.t - b.t || (a.id < b.id ? -1 : 1); });
      const myRank = members.findIndex(function (m) { return m.id === 'me'; });
      if (myRank < MAX_ROOM) return; // 古い順に8人までは、残る
      leaveRoom();
      toast('この部屋は満員のため、退出しました（' + MAX_ROOM + '人まで）');
    }
    setInterval(checkRoomFull, 5000);

    // ---------- 一覧の人数と、実際につながっている人数が合わないとき ----------
    // 在室通知（リレー経由）と、通話の接続（WebRTC）は、別々の仕組みなので、通知だけ先に見えて、接続がまだ、または失敗していることがある。
    // 10秒以上ずれたら、画面に知らせ、25秒以上ずれたら、自動でつなぎ直す（つなぎ直しは、90秒に1回まで）
    let mismatchNote = '', mismatchSince = 0, mismatchKey = '', lastAutoReconnect = 0;
    function checkMismatch() {
      if (!currentKey || !room) { mismatchSince = 0; mismatchKey = ''; if (mismatchNote) { mismatchNote = ''; renderPeers(); } return; }
      if (mismatchKey !== currentKey) { mismatchKey = currentKey; mismatchSince = 0; }
      let expected = 0;
      lobbyEntries.forEach(function (v) { if (v.ch === currentKey) expected++; });
      const connected = peerMap.size;
      if (expected <= connected) {
        mismatchSince = 0;
        if (mismatchNote) { mismatchNote = ''; renderPeers(); }
        return;
      }
      if (!mismatchSince) mismatchSince = Date.now();
      const dur = Date.now() - mismatchSince;
      if (dur > 10000) {
        const note = 'ほかに ' + (expected - connected) + ' 人が在室していますが、まだつながっていません（' + (autoReconnectOn ? 'つなぎ直しています' : '「再接続」を押すと、やり直せます') + '）';
        if (note !== mismatchNote) { mismatchNote = note; renderPeers(); }
      }
      if (dur > 25000 && Date.now() - lastAutoReconnect > 90000 && !reconnecting) {
        lastAutoReconnect = Date.now();
        mismatchSince = Date.now();
        reconnectRoom(true);
      }
    }
    setInterval(function () { checkMismatch(); updatePeerCount(); }, 3000);

    const lobbyEntries = new Map(); // 送り主の公開鍵 -> { ch(key), talking, name, tag, by, at, ts }
    // 再読み込みの直後は、他の人の在室通知が、届くまで（最大 6 秒）一覧が減って見える。直前の一覧を、20秒以内の分だけ、引き継ぐ
    function saveLobby() {
      try { sessionStorage.setItem('pochitalk_lobby', JSON.stringify({ at: Date.now(), list: Array.from(lobbyEntries.entries()) })); } catch (_) {}
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem('pochitalk_lobby') || 'null');
      if (saved && Array.isArray(saved.list)) saved.list.forEach(function (kv) { if (kv && kv[1] && Date.now() - kv[1].ts < 15000) lobbyEntries.set(kv[0], kv[1]); });
    } catch (_) {}
    window.addEventListener('pagehide', saveLobby);
    const PRESENCE_KIND = 29334, PRESENCE_TOPIC = 'pochitalk-presence-v1', PRESENCE_BEAT_MS = 6000, PRESENCE_EXPIRE_MS = 20000;
    let sendPresence = null, lobbyRoom = null; // 旧方式の名前（ほかの場所から参照されるので残してある。使わない）
    const pres = { schnorr: null, priv: null, pub: '', socks: new Map(), retry: new Map(), seen: new Map(), started: false, timer: null, lastSent: 0, pending: null, announced: false };

    async function presenceInit() {
      if (pres.schnorr) return true;
      try {
        const mod = await import('https://esm.sh/@noble/curves@1.4.0/secp256k1');
        pres.schnorr = mod.schnorr;
        pres.priv = pres.schnorr.utils.randomPrivateKey();
        pres.pub = toHex(pres.schnorr.getPublicKey(pres.priv));
        return true;
      } catch (_) { return false; }
    }

    async function presenceEvent(obj) {
      const tags = [['x', PRESENCE_TOPIC]];
      const created = Math.floor(Date.now() / 1000);
      const content = JSON.stringify(obj);
      const ser = JSON.stringify([0, pres.pub, created, PRESENCE_KIND, tags, content]);
      const idBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ser));
      const id = toHex(new Uint8Array(idBuf));
      const sig = toHex(await pres.schnorr.sign(id, pres.priv));
      return JSON.stringify(['EVENT', { id: id, pubkey: pres.pub, created_at: created, kind: PRESENCE_KIND, tags: tags, content: content, sig: sig }]);
    }

    async function presenceSend(obj) {
      if (!(await presenceInit())) return;
      const ev = await presenceEvent(obj);
      pres.socks.forEach(function (ws) { if (ws.readyState === 1) { try { ws.send(ev); } catch (_) {} } });
    }

    // 自分の在室を知らせる。連続して呼ばれても、1秒に1回にまとめる。部屋にいないときは何も送らない（出たときだけ、1回「いない」と送る）
    function announce() {
      if (!pres.started) return;
      const gap = Date.now() - pres.lastSent;
      if (gap < 1000) {
        if (!pres.pending) pres.pending = setTimeout(function () { pres.pending = null; announce(); }, 1000 - gap);
        return;
      }
      if (!currentKey) {
        if (!pres.announced) return;
        pres.announced = false; pres.lastSent = Date.now();
        presenceSend({ ch: '' });
        return;
      }
      pres.announced = true; pres.lastSent = Date.now();
      presenceSend({ ch: currentKey, cn: goodLinkCount(), ag: Math.floor((Date.now() - roomEnterTime) / 1000), talking: isTransmitting, name: myNickname, tag: roomMeta.tag, by: roomMeta.by, at: roomMeta.at });
    }
    function announceSoon() { setTimeout(announce, 300 + Math.random() * 1200); }

    function presenceOnMessage(data) {
      let m; try { m = JSON.parse(data); } catch (_) { return; }
      if (!Array.isArray(m) || m[0] !== 'EVENT' || !m[2]) return;
      const ev = m[2];
      if (!ev || ev.kind !== PRESENCE_KIND || !ev.pubkey || ev.pubkey === pres.pub) return;
      if (pres.seen.has(ev.id)) return; // 複数のリレーから、同じ知らせが届く
      pres.seen.set(ev.id, Date.now());
      if (typeof ev.created_at === 'number' && ev.created_at < Date.now() / 1000 - 120) return;
      let d; try { d = JSON.parse(ev.content); } catch (_) { return; }
      if (!d || typeof d.ch !== 'string') return;
      if (d.ch === '') { if (lobbyEntries.delete(ev.pubkey)) renderScan(); return; }
      if (!isKey(d.ch)) return;
      const isNew = !lobbyEntries.has(ev.pubkey);
      lobbyEntries.set(ev.pubkey, { ch: d.ch, ag: (typeof d.ag === 'number' && d.ag >= 0) ? d.ag : 9999, cn: (typeof d.cn === 'number' && d.cn >= 0 && d.cn < 32) ? d.cn : -1, talking: !!d.talking, name: String(d.name || '?').slice(0, 12), tag: capTag(d.tag), by: String(d.by || '').slice(0, 12), at: typeof d.at === 'number' ? d.at : 0, ts: Date.now() });
      if (isNew) announceSoon(); // 新しく来た人に、こちらの在室を、すぐ知らせる
      renderScan();
      if (d.ch === currentKey) updatePeerCount();
    }

    function presenceOpen(url) {
      if (!pres.started || pres.socks.has(url)) return;
      let ws; try { ws = new WebSocket(url); } catch (_) { return; }
      pres.socks.set(url, ws);
      ws.onopen = function () {
        pres.retry.set(url, 5000);
        try { ws.send(JSON.stringify(['REQ', 'pochi-presence', { kinds: [PRESENCE_KIND], '#x': [PRESENCE_TOPIC], since: Math.floor(Date.now() / 1000) - 5 }])); } catch (_) {}
        announce();
      };
      ws.onmessage = function (e) { presenceOnMessage(e.data); };
      ws.onclose = function () {
        if (pres.socks.get(url) !== ws) return; // 捨てた古い接続の終わり。新しい接続は、そのまま
        pres.socks.delete(url);
        if (!pres.started) return;
        const wait = Math.min(pres.retry.get(url) || 5000, 300000); // 落ちているリレーは、間隔を倍にしながら、再試行する
        pres.retry.set(url, wait * 2);
        setTimeout(function () { presenceOpen(url); }, wait);
      };
    }

    function joinLobby() {
      pres.started = true;
      presenceInit().then(function (ok) {
        if (!ok) return;
        aliveRelays.forEach(presenceOpen);
        if (pres.timer) return;
        pres.timer = setInterval(function () {
          const now = Date.now();
          lobbyEntries.forEach(function (v, k) { if (now - v.ts > PRESENCE_EXPIRE_MS) lobbyEntries.delete(k); });
          pres.seen.forEach(function (t, k) { if (now - t > 120000) pres.seen.delete(k); });
          announce();
          renderScan();
          saveLobby();
        }, PRESENCE_BEAT_MS);
      });
    }
    // 一覧を取り直す。切れたまま残った接続は捨てて、つなぎ直し、生きている接続には、購読をやり直して、自分の在室も知らせる
    function refreshLobby() {
      if (!pres.started) return;
      pres.retry.clear();
      pres.socks.forEach(function (ws, url) {
        if (ws.readyState === 1) {
          try { ws.send(JSON.stringify(['REQ', 'pochi-presence', { kinds: [PRESENCE_KIND], '#x': [PRESENCE_TOPIC], since: Math.floor(Date.now() / 1000) - 5 }])); } catch (_) {}
        } else if (ws.readyState !== 0) { // 閉じかけ・閉じた接続が残っている
          pres.socks.delete(url);
          try { ws.close(); } catch (_) {}
        }
      });
      aliveRelays.forEach(presenceOpen);
      announce();
      renderScan();
    }
    // 回線が戻ったら、すぐにつなぎ直す。画面に戻ったときも、一覧を取り直す
    window.addEventListener('online', refreshLobby);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(refreshLobby, 500); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) setTimeout(refreshLobby, 500); });

    function roomStats() {
      const stats = new Map();
      lobbyEntries.forEach(function (v) {
        const e = stats.get(v.ch) || { count: 0, air: false, names: [], tag: '', tagBy: '', tagAt: 0 };
        e.count++; e.names.push(v.name); if (v.talking) e.air = true;
        if (v.at > e.tagAt) { e.tagAt = v.at; e.tag = v.tag; e.tagBy = v.by; }
        stats.set(v.ch, e);
      });
      if (currentKey) {
        const me = stats.get(currentKey) || { count: 0, air: false, names: [], tag: '', tagBy: '', tagAt: 0 };
        if (roomMeta.at > me.tagAt) { me.tagAt = roomMeta.at; me.tag = roomMeta.tag; me.tagBy = roomMeta.by; }
        me.count++; me.names.unshift(myNickname + '(自分)'); if (isTransmitting) me.air = true;
        stats.set(currentKey, me);
      }
      return stats;
    }

    // ---------- 話題タグ ----------
    const TAG_MAX = 30;
    function charLen(t) { return Array.from(String(t || '')).length; }
    function capTag(t) {
      return Array.from(String(t || '')).filter(function (c) { const n = c.charCodeAt(0); return n >= 32 && n !== 127; }).slice(0, TAG_MAX).join('').trim();
    }
    const tagTextEl = document.getElementById('tagText'), tagEditBtn = document.getElementById('tagEdit');
    const tagForm = document.getElementById('tagForm'), tagInput = document.getElementById('tagInput');
    const tagCount = document.getElementById('tagCount');
    function updateTagCount() {
      const n = charLen(tagInput.value);
      tagCount.textContent = n;
      tagCount.parentNode.classList.toggle('full', n >= TAG_MAX);
    }
    // 編集中は「やめる」、それ以外は「つける / 変える」
    function syncTagBtn() {
      const open = !tagForm.classList.contains('hidden');
      tagEditBtn.textContent = open ? 'やめる' : (roomMeta.tag ? '変える' : 'つける');
    }
    function closeTagForm() { tagForm.classList.add('hidden'); syncTagBtn(); }
    function renderTagRow() {
      tagTextEl.replaceChildren();
      if (isBotRoom(currentKey)) {
        tagTextEl.textContent = BOT_ROOM_TAG;
        tagTextEl.title = '';
        tagEditBtn.classList.add('hidden');
        tagForm.classList.add('hidden');
        return;
      }
      tagEditBtn.classList.remove('hidden');
      if (roomMeta.tag) {
        const b = document.createElement('b'); b.textContent = roomMeta.tag;
        const by = document.createElement('span'); by.className = 'tag-by'; by.textContent = roomMeta.by ? '（' + roomMeta.by + 'が付けた）' : '';
        tagTextEl.append('🏷 ', b, by);
        tagTextEl.title = roomMeta.tag + (roomMeta.by ? '（' + roomMeta.by + 'が付けた）' : '');
      } else {
        tagTextEl.textContent = '🏷 話題タグ：まだありません';
        tagTextEl.title = '';
      }
      syncTagBtn();
    }
    function setTag(text) {
      if (!currentKey || isBotRoom(currentKey)) return;
      const t = capTag(text);
      roomMeta = { tag: t, by: t ? myNickname : '', at: Date.now() };
      if (sendTag) sendTag(roomMeta);
      renderTagRow(); announce(); renderScan();
    }
    tagEditBtn.addEventListener('click', function () {
      tagForm.classList.toggle('hidden');
      syncTagBtn();
      if (!tagForm.classList.contains('hidden')) { tagInput.value = roomMeta.tag || ''; updateTagCount(); tagInput.focus(); const end = tagInput.value.length; tagInput.setSelectionRange(end, end); } // 前のタグを残し、末尾から書き換え始める
    });
    tagInput.addEventListener('input', updateTagCount);
    document.getElementById('tagSend').addEventListener('click', function () { setTag(tagInput.value); closeTagForm(); });
    tagInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); setTag(tagInput.value); closeTagForm(); }
    });
    renderTagRow();

    const searchInput = document.getElementById('searchInput');

    // 検索語から、絞り込みの条件を作る（部屋のURL / ハッシュ / ニックネーム）
    function parseSearch() {
      const q = searchInput.value.trim();
      if (!q) return null;
      const m = q.match(/[?&]r=([0-9a-fA-F]{8})(?![0-9a-fA-F])/);
      const hexq = q.toLowerCase().replace(/[· -]/g, ''); // 区切り（· - 空白）を無視
      const exact = m ? m[1].toLowerCase() : (/^[0-9a-f]{8}$/.test(hexq) ? hexq : null);
      return { text: q.toLowerCase(), hex: /^[0-9a-f]{2,8}$/.test(hexq) ? hexq : null, exact: exact };
    }

    function matchSearch(key, st, f) {
      if (f.exact) return key === f.exact;
      if (f.hex && key.indexOf(f.hex) >= 0) return true;
      if (st.tag && st.tag.toLowerCase().indexOf(f.text) >= 0) return true;
      return st.names.some(function (n) { return n.toLowerCase().indexOf(f.text) >= 0; });
    }

    // ---------- 招待URLで開いたとき: 画面の先頭に、その部屋を大きく出す ----------
    const inviteCard = document.getElementById('inviteCard');
    let inviteShown = false;
    let previewShown = false;
    function idlePlaceholders() { // どこにも入っていないときの、本体の表示
      chDisplay.textContent = 'ROOM HASH';
      freqDisplay.textContent = '----·----';
      document.getElementById('tagText').textContent = '';
      statusLabel.textContent = 'STANDBY'; statusLabel.style.color = '#38bdf8';
      peersList.textContent = '';
      const e = document.createElement('span'); e.className = 'peers-empty'; e.textContent = '待機中（参加者なし）'; peersList.appendChild(e);
      peerCountEl.textContent = '';
    }
    // ダイヤルを合わせた部屋の様子を、入っていない本体の表示部分に出す
    function renderPreview() {
      if (currentKey || isInviteMode()) {
        if (previewShown) { // 入室した・招待された: ダイヤルの部屋の表示を、元に戻す
          previewShown = false;
          chDisplay.textContent = 'ROOM HASH';
          statusLabel.textContent = 'STANDBY'; statusLabel.style.color = '#38bdf8';
          if (currentKey) { document.getElementById('tagText').textContent = ''; renderTagRow(); renderPeers(); }
        }
        return;
      }
      const key = dialKeys[dialIndex()];
      const st = key ? roomStats().get(key) : null;
      if (!key || !st || st.invited || st.empty || !st.count) {
        if (previewShown) { previewShown = false; idlePlaceholders(); }
        return;
      }
      previewShown = true;
      chDisplay.textContent = 'ダイヤルの部屋';
      freqDisplay.textContent = fmt(key);
      document.getElementById('tagText').textContent = st.tag ? '🏷 ' + st.tag : '';
      statusLabel.textContent = '入室していません'; statusLabel.style.color = '#94a3b8';
      peersList.textContent = '';
      st.names.forEach(function (nm) { const sp = document.createElement('span'); sp.className = 'peer-tag'; sp.textContent = nm; peersList.appendChild(sp); });
      peerCountEl.textContent = '👤 ' + st.count + '人' + (st.count >= MAX_ROOM ? '（満員）' : '');
      peerCountEl.style.color = '#94a3b8';
    }
    // スマホのトップページでは、押せない「招待URL・QR・ミュート」の場所に、ハンドルネームと設定を置く
    function placeHomeControls() {
      let ck = null; try { ck = currentKey; } catch (_) {}
      const narrow = !document.body.classList.contains('wide');
      const want = !ck && narrow;
      const rv = document.getElementById('radioView');
      rv.classList.toggle('slot-on', want);
      const target = document.getElementById(want ? 'idleSlot' : 'homeCard');
      const nb = document.getElementById('nameBox'), sb = document.getElementById('settingsBtn');
      if (nb.parentElement !== target) { target.appendChild(nb); target.appendChild(sb); }
    }
    function isInviteMode() { return !!pendingKey && !currentKey; }
    function setPttLabel(key) { // 大きなボタンの役割: 部屋の中=話す / 招待された部屋=入室 / どこにも入っていない=新しい部屋を作る
      const pm = pttBtn.querySelector('.ptt-main'), ps = pttBtn.querySelector('.ptt-sub');
      const inv = !!pendingKey && !key;
      if (pm) pm.textContent = key ? 'PUSH' : (inv ? 'JOIN' : 'NEW');
      if (ps) ps.textContent = key ? 'TO TALK' : (inv ? '入室' : '新しい部屋');
    }
    let createGuard = false;
    function createFromPtt() { if (createGuard || currentKey) return; createGuard = true; setTimeout(function () { createGuard = false; }, 1500); document.getElementById('emptyBtn').click(); }
    function joinInvited() { if (isInviteMode()) tuneKey(pendingKey); }
    function renderInvite(st) {
      placeHomeControls();
      const on = isInviteMode();
      inviteCard.classList.add('hidden'); // 旧い招待カードは使わない（本体に表示する）
      const rv = document.getElementById('radioView');
      rv.classList.toggle('invite', on);
      rv.classList.toggle('idle', !currentKey && !on);
      document.getElementById('inviteLinks').classList.toggle('hidden', !on);
      setPttLabel(currentKey);
      if (on) {
        inviteShown = true;
        chDisplay.textContent = 'INVITED';
        freqDisplay.textContent = fmt(pendingKey);
        document.getElementById('tagText').textContent = (st && st.tag) ? '🏷 ' + st.tag : '';
        statusLabel.textContent = '招待された部屋'; statusLabel.style.color = '#fbbf24';
        peersList.textContent = '';
        if (st && st.count > 0) {
          st.names.forEach(function (nm) { const sp = document.createElement('span'); sp.className = 'peer-tag'; sp.textContent = nm; peersList.appendChild(sp); });
        } else {
          const e = document.createElement('span'); e.className = 'peers-empty'; e.textContent = 'いまは誰もいません。入って待つこともできます'; peersList.appendChild(e);
        }
        peerCountEl.textContent = '👤 ' + ((st && st.count) || 0) + '人';
        peerCountEl.style.color = '#fbbf24';
      } else if (inviteShown) {
        inviteShown = false;
        chDisplay.textContent = 'ROOM HASH';
        statusLabel.textContent = 'STANDBY'; statusLabel.style.color = '#38bdf8';
        if (currentKey) { freqDisplay.textContent = fmt(currentKey); renderTagRow(); renderPeers(); }
        else { idlePlaceholders(); renderPreview(); }
      } else { renderPreview(); }
    }
    document.getElementById('inviteJoin').addEventListener('click', function () { if (pendingKey) tuneKey(pendingKey); });
    document.getElementById('inviteLater').addEventListener('click', function () {
      pendingKey = null;
      try { history.replaceState(null, '', location.pathname); } catch (_) {}
      renderScan();
    });
    document.getElementById('inviteAbout').addEventListener('click', function () { openDialog(aboutDialog); });
    document.getElementById('inviteLater2').addEventListener('click', function () { document.getElementById('inviteLater').click(); });
    document.getElementById('inviteNew2').addEventListener('click', function () { document.getElementById('inviteLater').click(); createFromPtt(); }); // 招待を閉じて、自分で新しい部屋を作る
    document.getElementById('inviteAbout2').addEventListener('click', function () { openDialog(aboutDialog); });

    function appendNames(el, names) { // 名前を1人ずつ割れない要素で並べる（改行は「、」の後だけ）
      names.forEach(function (nm, i) {
        if (i) el.appendChild(document.createTextNode('、'));
        const ns = document.createElement('span');
        ns.className = 'chip-name';
        ns.textContent = nm;
        el.appendChild(ns);
      });
    }

    // ---------- 部屋を探すダイヤル ----------
    const DIAL_ROW = 132; // 1行の高さ(px)。CSS の --rdial-row と同じ
    let dialKeys = [];
    let dialBusy = false, dialPending = false, dialTimer = null, dialProgrammatic = false, dialLastIdx = -1, dialLastTick = 0, dialRaf = 0;
    function dialIndex() { return Math.max(0, Math.min(Math.max(0, dialKeys.length - 1), Math.round(scanList.scrollTop / DIAL_ROW))); }
    function dialTick() { // ダイヤルが1つ進むごとの、カチッという音（音が出せる状態のときだけ）
      const now = Date.now();
      if (now - dialLastTick < 45) return;
      dialLastTick = now;
      try { if (navigator.vibrate) navigator.vibrate(4); } catch (_) {}
      try {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.type = 'square'; osc.frequency.value = 1900;
        g.gain.setValueAtTime(0.03, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.02);
        osc.connect(g); g.connect(sfxOut(audioCtx));
        osc.start(); osc.stop(audioCtx.currentTime + 0.025);
      } catch (_) {}
    }
    // 円柱（ドラム）の形に見せる: 部屋は円柱の表面に並び、中央の1行が、真正面を向く。
    // 1行ぶん回すと STEP 度回る。上下の部屋は、奥に回り込み、縦に詰まって、暗くなる。
    const DIAL_STEP = 36;                                   // 1行あたりの回転角（度）。大きいほど、上下の部屋が、強く詰まって見える
    const DIAL_R = DIAL_ROW / (DIAL_STEP * Math.PI / 180);   // 円柱の半径（px）。中央付近で、スクロールと同じ速さで動くように決める
    const railTicks = [], ridges = [];
    (function makeParts() {
      // 円柱の側面を横切る、細い線（全幅）。回すと流れ、上下に行くほど間隔が詰まる = 丸く見える
      const box = document.getElementById('ridges');
      for (let k = 0; k < 36; k++) { const r = document.createElement('div'); r.className = 'rdial-ridge'; box.appendChild(r); ridges.push({ el: r, a: k * 10 }); }
      // 両端の目盛りの溝
      ['railL', 'railR'].forEach(function (id) {
        const rail = document.getElementById(id);
        for (let k = 0; k < 30; k++) { const t = document.createElement('div'); t.className = 'rdial-tick'; rail.appendChild(t); railTicks.push({ el: t, a: k * 12 }); }
      });
    })();
    function dialUpdate() {
      const kids = scanList.children, top = scanList.scrollTop, idx = dialIndex();
      const rot = top / DIAL_ROW * DIAL_STEP; // いまの円柱の回転角（度）
      // 円柱を真横から見た形（左右にはずらさない・ゆがめない。縦方向にだけ、詰める）
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        if (!el.classList.contains('rdial-item')) continue;
        const off = (i * DIAL_ROW - top) / DIAL_ROW;                 // 中央との差（行数）
        const th = Math.max(-88, Math.min(88, off * DIAL_STEP));      // 円柱の上での角度
        const rad = th * Math.PI / 180;
        const c = Math.cos(rad);
        const dy = DIAL_R * Math.sin(rad) - off * DIAL_ROW;           // 平らに並べたときの位置から、円柱の上の位置へのずれ
        // 文字は、ドラムの面に印刷されている。左右には動かさず、縦方向だけ、円柱の丸みの分、詰める（上下の端ほど、細かく詰まる）
        el.style.transform = 'translateY(' + dy.toFixed(1) + 'px) scaleY(' + Math.max(0.04, c).toFixed(3) + ')';
        el.style.opacity = Math.abs(off) > 2.6 ? '0' : String(Math.max(0.12, Math.pow(c, 1.1)).toFixed(2));
        el.style.filter = (el.classList.contains('full') ? 'grayscale(0.7) ' : '') + 'brightness(' + (0.5 + 0.5 * c).toFixed(2) + ')';
        el.classList.toggle('on-line', i === idx);
      }
      const place = function (list, alpha, edgeHeavy) {
        for (let n = 0; n < list.length; n++) {
          const rt = list[n];
          const rel = ((rt.a - rot) % 360 + 540) % 360 - 180;       // -180〜180
          if (Math.abs(rel) > 86) { rt.el.style.opacity = '0'; continue; }
          const rr = rel * Math.PI / 180;
          const k = edgeHeavy ? (0.12 + 0.88 * (1 - Math.cos(rr))) : (0.2 + 0.8 * Math.cos(rr));
          rt.el.style.opacity = String((alpha * k).toFixed(2));
          rt.el.style.transform = 'translateY(' + (DIAL_R * Math.sin(rr)).toFixed(1) + 'px)';
        }
      };
      place(ridges, 1, true);   // 横切る線は、円柱の端ほど濃く、中央ほど薄く（文字に重なって、うるさくならないように）
      place(railTicks, 1, false);
      if (idx !== dialLastIdx) { if (dialLastIdx >= 0 && !dialProgrammatic) dialTick(); dialLastIdx = idx; renderPreview(); renderDialDetail(); }
    }
    function renderDialDetail() {
      const box = document.getElementById('dialDetail');
      if (!box) return;
      const key = dialKeys[dialIndex()];
      const st = key ? roomStats().get(key) : null;
      box.textContent = '';
      if (!key || !st) { const e = document.createElement('div'); e.className = 'dd-count'; e.textContent = 'ダイヤルを回して、部屋を選んでください'; box.appendChild(e); return; }
      const t = document.createElement('div'); t.className = 'dd-title'; t.textContent = fmt(key); box.appendChild(t);
      if (st.tag) { const g = document.createElement('div'); g.className = 'dd-tag'; g.textContent = '🏷 ' + st.tag + (st.tagBy ? '（' + st.tagBy + '）' : ''); box.appendChild(g); }
      const c = document.createElement('div'); c.className = 'dd-count';
      c.textContent = st.invited ? '招待された部屋（いまは無人）' : (st.empty || !st.count) ? 'いまは誰もいません' : '👤 ' + st.count + '人' + (st.count >= MAX_ROOM ? '（満員）' : '');
      box.appendChild(c);
      if (st.names && st.names.length) {
        const nm = document.createElement('div'); nm.className = 'dd-names';
        st.names.forEach(function (n) { const sp = document.createElement('span'); sp.textContent = n; nm.appendChild(sp); });
        box.appendChild(nm);
      }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-sub';
      const here = key === currentKey;
      b.textContent = here ? 'いま入っている部屋です' : 'この部屋に入る';
      b.disabled = here || (st.count >= MAX_ROOM && !here);
      b.addEventListener('click', function () { tuneKey(key); });
      box.appendChild(b);
    }
    function dialGo(i) { scanList.scrollTo({ top: Math.max(0, Math.min(dialKeys.length - 1, i)) * DIAL_ROW, behavior: 'smooth' }); }
    // ダイヤルにフォーカスがなくても、カーソルキーの上下で、1つずつ回す（入力欄・ダイアログの中では、使わない）
    window.addEventListener('keydown', function (e) {
      if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.target === scanList || isTyping() || document.querySelector('dialog[open]')) return;
      const f = document.activeElement;
      if (f && (f.tagName === 'SELECT' || f.tagName === 'TEXTAREA' || f.tagName === 'INPUT' && f.type !== 'checkbox' && f.type !== 'button')) return;
      if (!dialKeys.length) return;
      e.preventDefault();
      dialGo(dialIndex() + (e.key === 'ArrowDown' ? 1 : -1));
    });
    function dialEnter() { const key = dialKeys[dialIndex()]; if (key) tuneKey(key); }
    function dialIdleSoon(ms) {
      clearTimeout(dialTimer);
      dialTimer = setTimeout(function () { dialBusy = false; if (dialPending) { dialPending = false; renderScan(); } }, ms);
    }
    scanList.addEventListener('scroll', function () {
      if (!dialRaf) dialRaf = requestAnimationFrame(function () { dialRaf = 0; dialUpdate(); });
      if (dialProgrammatic) return;
      dialBusy = true; dialIdleSoon(280); // 回している間は、一覧を作り直さない（回している最中に動かないように）
    }, { passive: true });
    ['pointerdown', 'touchstart'].forEach(function (ev) { scanList.addEventListener(ev, function () { dialBusy = true; clearTimeout(dialTimer); }, { passive: true }); });
    ['pointerup', 'touchend', 'pointercancel'].forEach(function (ev) { scanList.addEventListener(ev, function () { dialIdleSoon(400); }, { passive: true }); });
    scanList.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { dialGo(dialIndex() + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { dialGo(dialIndex() - 1); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === ' ') { dialEnter(); e.preventDefault(); e.stopPropagation(); } // スペースを、話すキーとして扱わせない
    });

    let dialShownKey = null;
    function buildDial(keys, stats, f) {
      if (dialBusy) { dialPending = true; return; }
      const prevKey = dialKeys[dialIndex()], prevIdx = dialIndex();
      scanList.textContent = '';
      dialKeys = keys.slice();
      if (!keys.length) {
        const none = document.createElement('div');
        none.className = 'rdial-empty';
        none.textContent = f ? '該当する部屋がありません' : 'いまある部屋はありません。新しい部屋を作ってください';
        scanList.appendChild(none);
        dialLastIdx = -1;
        return;
      }
      keys.forEach(function (key, i) {
        const st = stats.get(key);
        const b = document.createElement('div');
        b.className = 'rdial-item' + (key === BOT_ROOM_KEY ? ' bot' : '') + (key === currentKey ? ' me' : '') + (st.air ? ' air' : '') + (key === pendingKey ? ' invited' : '') + (st.count >= MAX_ROOM && key !== currentKey ? ' full' : '');
        b.setAttribute('role', 'option');
        b.dataset.key = key;
        const head = document.createElement('div');
        head.textContent = (key === BOT_ROOM_KEY ? '🦜 ' : '') + (st.air ? '🔴 ' : '🔵 ') + fmt(key) + ' · 👤' + st.count + (key === currentKey && st.count !== peerMap.size + 1 ? '（つながっているのは ' + (peerMap.size + 1) + ' 人）' : '') + (st.count >= MAX_ROOM ? ' · 満員' : '') + (key === pendingKey ? ' · 招待' : '');
        b.appendChild(head);
        if (st.tag) {
          const tg = document.createElement('div');
          tg.className = 'chip-tag';
          tg.textContent = '🏷 ' + st.tag + (st.tagBy ? '（' + st.tagBy + '）' : '');
          b.appendChild(tg);
        }
        const who = document.createElement('div');
        who.className = 'chip-who';
        if (st.invited) who.textContent = '招待された部屋（現在は無人）';
        else if (st.empty) who.textContent = 'この部屋には、いま誰もいません';
        else appendNames(who, st.names);
        b.appendChild(who);
        // 赤い線に合わせた部屋をタップすると入る。ほかの部屋をタップすると、そこまで回る
        b.addEventListener('click', function () { if (i === dialIndex()) tuneKey(key); else dialGo(i); });
        scanList.appendChild(b);
      });
      // 再描画のあとも、同じ部屋が、赤い線の位置に残るようにする（初回は、いまいる部屋、なければ先頭）
      let at = prevKey ? keys.indexOf(prevKey) : -1;
      // 入室したときは、その部屋が、赤い線の位置に来る
      if (currentKey !== dialShownKey) { dialShownKey = currentKey; if (currentKey && keys.indexOf(currentKey) >= 0) at = keys.indexOf(currentKey); }
      if (at < 0) at = dialLastIdx < 0 ? Math.max(0, keys.indexOf(currentKey)) : Math.min(prevIdx, keys.length - 1);
      dialProgrammatic = true;
      scanList.scrollTop = at * DIAL_ROW;
      dialLastIdx = at;
      dialUpdate();
      renderPreview();
      renderDialDetail();
      setTimeout(function () { dialProgrammatic = false; }, 120);
    }

    function renderScan() {
      const stats = roomStats();
      if (pendingKey && !stats.has(pendingKey)) stats.set(pendingKey, { count: 0, air: false, names: [], invited: true });
      const f = parseSearch();
      // URLやハッシュで指定された部屋に、いま誰もいない場合も、入れるように出す
      if (f && f.exact && !stats.has(f.exact)) stats.set(f.exact, { count: 0, air: false, names: [], empty: true });
      // おうむ返しの部屋は、無人でも、いつも一覧に出す（指定がなければ、ここに合わせる）
      if (!f && !stats.has(BOT_ROOM_KEY)) stats.set(BOT_ROOM_KEY, { count: 0, air: false, names: [], empty: true });
      const allKeys = Array.from(stats.keys()).sort();
      let keys = f ? allKeys.filter(function (k) { return matchSearch(k, stats.get(k), f); }) : allKeys;
      // 招待された部屋は、一覧の先頭に出す
      if (keys.indexOf(BOT_ROOM_KEY) > 0) keys = [BOT_ROOM_KEY].concat(keys.filter(function (k) { return k !== BOT_ROOM_KEY; })); // ボットの部屋は、いつも先頭
      if (pendingKey && keys.indexOf(pendingKey) >= 0) keys = [pendingKey].concat(keys.filter(function (k) { return k !== pendingKey; }));
      renderInvite(pendingKey ? stats.get(pendingKey) : null);
      let total = 0;
      stats.forEach(function (v) { total += v.count; });
      onlineCount.textContent = f
        ? '🔍 ' + keys.length + ' / ' + allKeys.length + '部屋'
        : '👥 ' + total + '人 / ' + allKeys.length + '部屋';
      buildDial(keys, stats, f);
    }
    searchInput.addEventListener('input', renderScan);

    // ---------- 再接続（部屋には入ったまま、通話とロビーの接続を張り直す）----------
    let reconnecting = false, hiddenAt = 0;
    let autoReconnectOn = false; // 自動の再接続は、標準ではオフ（端末どうしが、つなぎ直しを繰り返して、お互いを邪魔するため）
    try { autoReconnectOn = localStorage.getItem('pochitalk_autoreconnect') === '1'; } catch (_) {}
    // 再接続は、ページごと読み込み直す（ぽっと通話と同じ方式）。ページ内で leave → join し直すと、Trystero は相手との接続を閉じずに使い回し、
    // 退出時に作った再交渉の offer も送れずに残るので、入り直しても音声の経路が固まったままになる（名前や合図は届くので、部屋にいるように見える）。
    // 読み込み直せば、接続も自分の ID も作り直され、相手からは正真正銘の新しい参加者になる。入る部屋と VOX は sessionStorage で引き継ぐ
    const REJOIN_KEY = 'pochitalk_rejoin', AUTO_RELOAD_KEY = 'pochitalk_auto_reloads';
    function autoReloadAllowed() { // 自動の読み込み直しは 10 分に 2 回まで（壊れたまま直らないときに、読み込みが繰り返されて操作できなくなるのを防ぐ）
      let arr = [];
      try { arr = JSON.parse(sessionStorage.getItem(AUTO_RELOAD_KEY) || '[]'); } catch (_) {}
      const now = Date.now();
      arr = Array.isArray(arr) ? arr.filter(function (t) { return now - t < 600000; }) : [];
      if (arr.length >= 2) return false;
      arr.push(now);
      try { sessionStorage.setItem(AUTO_RELOAD_KEY, JSON.stringify(arr)); } catch (_) {}
      return true;
    }
    async function reconnectRoom(auto, force) { // force: 自己修復から（自動の設定がオフでも動く）
      if (auto && !autoReconnectOn && !force) return;
      if (!currentKey || reconnecting) return;
      if (auto && !autoReloadAllowed()) { flashSub('つながりません。「再接続」を押すか、時間をおいて入り直してください'); return; }
      reconnecting = true;
      const btn = document.getElementById('reconnectBtn');
      btn.disabled = true;
      btn.textContent = '再接続中…';
      flashSub(auto ? '接続が切れた可能性があるので、つなぎ直しています…' : '再接続中…');
      try { sessionStorage.setItem(REJOIN_KEY, JSON.stringify({ key: currentKey, vox: voxCheck.checked, at: Date.now() })); } catch (_) {}
      if (isTransmitting) { pressed = false; stopTransmission(); }
      const oldRoom = room;
      room = null;
      try { pres.announced = false; presenceSend({ ch: '' }); } catch (_) {} // 一覧からも、いったん消す（残ると、読み込み直したあとの人数が 1 人多く見える）
      // 退出の知らせを先に送ってから読み込み直す（相手がこちらの離脱を早く知るほど、戻ったときにすんなり繋ぎ直してもらえる）。届かなくても 1.2 秒で進める
      try { await Promise.race([closeOldConnections(oldRoom), wait(1200)]); } catch (_) {}
      location.reload();
    }
    // 読み込み直しの後半: 予約があれば、同じ部屋に入り直す（init から呼ぶ）
    function rejoinAfterReload() {
      let r = null;
      try { r = JSON.parse(sessionStorage.getItem(REJOIN_KEY) || 'null'); sessionStorage.removeItem(REJOIN_KEY); } catch (_) {}
      if (!r || !isKey(r.key) || typeof r.at !== 'number' || Date.now() - r.at > 60000) return false;
      tuneKey(r.key);
      flashSub('再接続しました。相手が見つかるまで少し待ってください');
      if (r.vox) initMicrophone(true).then(function (ok) { if (ok && currentKey === r.key) { setVoxUI(true); startVox(); } });
      return true;
    }
    document.getElementById('reconnectBtn').addEventListener('click', function () { reconnectRoom(false); });
    // 回線が戻ったときは、自動でつなぎ直す
    window.addEventListener('online', function () { reconnectRoom(true); });
    // ---------- QRコード（裏返して、裏面に招待QRを見せる）----------
    const radioEl = document.getElementById('radioView'), frontFace = document.getElementById('frontFace'), backFace = document.getElementById('backFace');
    let flipping = false;
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    async function renderQr() {
      const url = location.origin + location.pathname + '?r=' + currentKey;
      document.getElementById('qrRoom').textContent = fmt(currentKey);
      document.getElementById('qrUrl').textContent = url;
      const box = document.getElementById('qrBox');
      box.textContent = '読み込み中…';
      try {
        const mod = await import('https://esm.sh/qrcode-generator@1.4.4'); // QRボタンを押したときだけ読み込む
        const qrcode = mod.default || mod;
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
      } catch (_) {
        box.textContent = 'QRコードを読み込めませんでした。招待URLのコピーをお使いください。';
      }
    }

    async function flipTo(showBack) {
      if (flipping || !currentKey) return;
      if (showBack === radioEl.classList.contains('flipped')) return;
      flipping = true;
      try {
        if (showBack) { await renderQr(); backFace.style.minHeight = frontFace.offsetHeight + 'px'; }
        const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const swap = function () {
          frontFace.classList.toggle('hidden', showBack);
          backFace.classList.toggle('hidden', !showBack);
          radioEl.classList.toggle('flipped', showBack);
        };
        if (still) { swap(); return; }
        radioEl.style.transition = 'transform .2s ease-in';
        radioEl.style.transform = 'perspective(900px) rotateY(90deg)';
        await wait(200);
        swap();
        radioEl.style.transition = 'none';
        radioEl.style.transform = 'perspective(900px) rotateY(-90deg)';
        void radioEl.offsetWidth;
        radioEl.style.transition = 'transform .22s ease-out';
        radioEl.style.transform = 'perspective(900px) rotateY(0deg)';
        await wait(230);
        radioEl.style.transition = ''; radioEl.style.transform = '';
      } finally { flipping = false; }
    }

    // 部屋を出る・移るときは、アニメーションなしで表に戻す
    function resetFlip() {
      radioEl.classList.remove('flipped');
      frontFace.classList.remove('hidden');
      backFace.classList.add('hidden');
      radioEl.style.transition = ''; radioEl.style.transform = '';
    }
    document.getElementById('qrBtn').addEventListener('click', function () { document.getElementById('qrBtn').blur(); flipTo(!radioEl.classList.contains('flipped')); }); // QRボタンで、見せる・閉じるを切り替える
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && radioEl.classList.contains('flipped')) flipTo(false); });

    // ---------- バックグラウンド / フォアグラウンド ----------
    // iPhone などは、バックグラウンドに回るとページの処理とマイクが止まり、接続が切れる。
    // 戻ってきたときに、必要なら自動でつなぎ直し、マイクも取り直す。
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let leftAt = 0; // バックグラウンドに回った時刻

    function goneBackground() { if (!leftAt) leftAt = Date.now(); }

    function peersUnhealthy() {
      try {
        const pcs = room ? room.getPeers() : {};
        return Object.keys(pcs).some(function (id) {
          const st = pcs[id] && pcs[id].connectionState;
          return st === 'failed' || st === 'disconnected' || st === 'closed';
        });
      } catch (_) { return false; }
    }

    function backToForeground() {
      const away = leftAt ? Date.now() - leftAt : 0;
      leftAt = 0;
      if (!currentKey) return;
      try { getAudioContext(); } catch (_) {}
      const micDead = !!userMediaStream && userMediaStream.getAudioTracks().every(function (t) { return t.readyState === 'ended'; });
      // iPhone は少し離れただけでも切れやすいので、短い時間でもつなぎ直す。ほかの端末は、切れているか、長く離れたときだけ
      const need = micDead || peersUnhealthy() || away > (isIOS ? 3000 : 20000);
      if (!need) return;
      const voxWasOn = voxCheck.checked;
      if (micDead) { if (voxWasOn) { setVoxUI(false); stopVox(); } releaseMic(); } // 止まったマイクは捨てて、取り直す
      reconnectRoom(true).then(function () {
        if (userMediaStream) return;
        initMicrophone(true).then(function (ok) {
          if (ok && voxWasOn) { setVoxUI(true); startVox(); }
          else if (!ok) flashSub('マイクが止まりました。話すボタンを押して、もう一度許可してください');
        });
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) goneBackground(); else backToForeground();
    });
    window.addEventListener('pagehide', goneBackground);
    // 再読み込みや閉じるときだけ（バックグラウンドに回るだけのときは除く）、通話の接続・マイク・リレーとの接続を、先に片付ける。iPad の Safari は、片付けの終わりを待つので、再読み込みが遅くなる
    window.addEventListener('pagehide', function (e) {
      if (e.persisted) return;
      try { if (diagTimer) { clearInterval(diagTimer); diagTimer = null; } } catch (_) {}
      try { if (room) { room.leave(); } } catch (_) {}
      try { pres.socks.forEach(function (ws) { try { ws.close(); } catch (_) {} }); } catch (_) {}
      try { releaseMic(); } catch (_) {}
    });
    window.addEventListener('pageshow', function (e) { if (e.persisted) backToForeground(); });
    document.addEventListener('freeze', goneBackground);
    document.addEventListener('resume', backToForeground);

    document.getElementById('emptyBtn').addEventListener('click', function () {
      const key = toHex(crypto.getRandomValues(new Uint8Array(4)));
      tuneKey(key);
      flashSub('新しい部屋を作りました。招待で友達を呼べます');
    });

    const aboutDialog = document.getElementById('aboutDialog');
    const settingsDialog = document.getElementById('settingsDialog');
    const welcomeDialog = document.getElementById('welcomeDialog');
    function openDialog(d) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    document.getElementById('settingsBtn').addEventListener('click', function () { openDialog(settingsDialog); });
    function closeSettings() { settingsDialog.close(); endMicTest(); if (!room) releaseMic(); }
    document.getElementById('settingsClose').addEventListener('click', closeSettings);
    settingsDialog.addEventListener('click', function (e) { if (e.target === settingsDialog) closeSettings(); });
    // 設定を閉じたら、マイクテストを止めてマイクを解放する（入室中は部屋が使うのでそのまま）
    settingsDialog.addEventListener('close', function () { endMicTest(); if (!room) releaseMic(); });
    // ---------- 通信の診断（設定の中。相手ごとの接続の状態と、リレーの様子）----------
    const diagBox = document.getElementById('diagBox');
    let diagTimer = null;
    function diagLine(parent, text, color) {
      const d = document.createElement('div');
      d.textContent = text;
      if (color) d.style.color = color;
      parent.appendChild(d);
    }
    const diagPanel = document.getElementById('diagPanel');
    const diagAlwaysChk = document.getElementById('diagAlways');
    function diagStop() {
      if (diagTimer) { clearInterval(diagTimer); diagTimer = null; }
      diagPanel.classList.remove('on');
      document.body.classList.remove('diag-on');
      try { localStorage.setItem('pochitalk_diag_always', '0'); } catch (_) {}
      diagAlwaysChk.checked = false;
    }
    function diagStart() {
      diagPanel.classList.add('on');
      document.body.classList.add('diag-on');
      diagRender().catch(function () {});
      if (!diagTimer) diagTimer = setInterval(diagRender, 2000);
    }
    const diagPrev = new Map();
    // 音声の取り決めが、途中で止まった相手を、見つけて、やり直す。
    // 通話の部品（Trystero 0.25.4）は、つながったあとに、自分の声を送る準備（通り道の追加）をするとき、取り決めの要求を取りこぼすことがある。
    // 取りこぼすと、相手との接続は「つながっている」のに、自分の声が、その相手に届かない（診断の「向き」が「sendrecv→なし」になる）。
    // 診断で見つけたら、同じ要求を、もう一度、出す（通常の取り決めと同じ手順なので、害はない）。数回までにする
    const healState = new Map();
    let lastEscalate = 0;
    window.healCount = 0;
    function healAudio() {
      let pcs = {};
      try { pcs = room ? room.getPeers() : {}; } catch (_) { return; }
      const now = Date.now();
      healState.forEach(function (v, id) { if (!pcs[id]) healState.delete(id); });
      Object.keys(pcs).forEach(function (id) {
        const pc = pcs[id];
        let stuck = false;
        try {
          stuck = pc.connectionState === 'connected' && pc.signalingState === 'stable' && pc.getTransceivers().some(function (t) {
            return t.sender && t.sender.track && (t.direction === 'sendrecv' || t.direction === 'sendonly') && t.currentDirection === null;
          });
        } catch (_) {}
        let st = healState.get(id);
        if (!stuck) { if (st) healState.delete(id); return; }
        if (!st) { healState.set(id, { since: now, tries: 0, last: 0 }); return; }
        if (st.tries >= 6 && now - st.last > 8000 && now - lastEscalate > 300000 && !document.hidden && !isTransmitting && !reconnecting) {
          // 4回やり直しても直らない: この端末だけ、1回、退出して入り直す（全員が同時に動かないよう、5分に1回まで）
          lastEscalate = now; healState.delete(id);
          if (window.pcLog) window.pcLog.push(pcClock() + ' 取り決めが直らないため、入り直します');
          reconnectRoom(true, true);
          return;
        }
        if (now - st.since < 2000 || st.tries >= 6 || now - st.last < 4000) return;
        st.tries++; st.last = now; window.healCount++;
        const meta = peerMap.get(id);
        if (window.pcLog) window.pcLog.push(pcClock() + ' 音声の取り決めをやり直し ' + ((meta && meta.name) || id.slice(0, 5)) + '（' + st.tries + '回目）');
        try { if (typeof pc.onnegotiationneeded === 'function') pc.onnegotiationneeded(new Event('negotiationneeded')); } catch (_) {}
      });
    }
    setInterval(healAudio, 1000);
    function healSoon() { setTimeout(healAudio, 800); setTimeout(healAudio, 2500); } // 音声を足した直後に、取り決めが始まったか、すぐ確かめる（アプリ版は、取り決めの開始を、必ず受け取る）
    async function diagRender() {
      const out = document.createElement('div');
      diagLine(out, '版 ' + (document.getElementById('appVersion').textContent || '').replace('版 ', '') + ' / ' + (navigator.onLine ? 'オンライン' : 'オフライン') + ' / ' + (document.hidden ? '裏' : '表'));
      const st0 = currentKey ? roomStats().get(currentKey) : null;
      diagLine(out, '部屋: ' + (currentKey ? fmt(currentKey) : '（入っていません）') + ' / 一覧では ' + (st0 ? st0.count : 0) + ' 人 / つながっているのは ' + (currentKey ? peerMap.size + 1 : 0) + ' 人（自分を含む）');
      (function () {
        const lr = linkRanking();
        if (!lr) return;
        diagLine(out, 'つながりの順位（少ない順・先頭が入り直す番）:');
        lr.rows.forEach(function (r, i) {
          const mark = (lr.weakest && lr.weakest.key === r.key) ? '　← 入り直し推奨' : '';
          diagLine(out, '　' + (i + 1) + '. ' + r.name + (r.me ? '（自分）' : '') + ' ' + r.cn + '/' + (lr.total - 1) + ' 本' + (r.ag < 45 ? '（入室直後）' : '') + mark, mark ? '#f87171' : (r.cn >= lr.total - 1 ? '#4ade80' : '#fbbf24'));
        });
        if (lr.unknown) diagLine(out, '　順位に入っていない端末: ' + lr.unknown + ' 台（古い版など）');
        if (lr.weakest && lr.weakest.me) diagLine(out, '→ あなたが一番つながっていません。入り直してください（ほかの人は、入り直さないでください）', '#f87171');
        else if (lr.weakest) diagLine(out, '→ 入り直すのは「' + lr.weakest.name + '」です。あなたは、そのままで大丈夫です', '#4ade80');
      })();
      let rs = 0;
      pres.socks.forEach(function (w) { if (w.readyState === 1) rs++; });
      diagLine(out, '一覧用のリレー: ' + rs + ' / ' + aliveRelays.length + ' 本がつながっています');
      diagLine(out, '音声の処理（AudioContext）: ' + (audioCtx ? audioCtx.state : '未作成') + (audioCtx && audioCtx.state !== 'running' ? '　← 止まっています。画面を1回タップ（クリック）してください' : ''), audioCtx && audioCtx.state !== 'running' ? '#f87171' : '');
      diagLine(out, '自分: ' + (isTransmitting ? '送信中' : '待機') + ' / VOX ' + (voxCheck.checked ? 'オン' : 'オフ') + ' / スピーカー ' + (speakerMuted ? 'ミュート' : 'オン'));
      diagLine(out, '通話用のリレー: ' + ROOM_RELAYS.length + ' 本を使用 / 経路: ' + (FORCE_RELAY ? '中継のみ' : '直接を優先'));
      let pcs = {};
      try { pcs = room ? room.getPeers() : {}; } catch (_) {}
      const ids = Object.keys(pcs);
      if (currentKey && !ids.length) diagLine(out, '相手とのつながりは、まだありません', '#fbbf24');
      for (const id of ids) {
        const pc = pcs[id];
        const meta = peerMap.get(id);
        let route = '?', rtt = '', inb = '', outB = -1, outP = 0, inP = -1;
        try {
          const stats = await pc.getStats();
          let pairId = null;
          stats.forEach(function (r) { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId; });
          stats.forEach(function (r) {
            if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) {
              const prev = diagPrev.get(id) || { b: 0, e: 0 };
              const db = (r.bytesReceived || 0) - prev.b;
              const de = (r.totalAudioEnergy || 0) - prev.e;
              diagPrev.set(id, { b: r.bytesReceived || 0, e: r.totalAudioEnergy || 0 });
              inb = ' / 受信 ' + Math.round(db / 1024 * 10) / 10 + 'KB/2秒, 音量 ' + (typeof r.audioLevel === 'number' ? r.audioLevel.toFixed(3) : '?') + ', 音の量の増加 ' + de.toFixed(4);
            }
          });
          stats.forEach(function (r) {
            if (r.type === 'outbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) { outB = r.bytesSent || 0; outP = r.packetsSent || 0; }
            if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) { inP = r.packetsReceived || 0; }
          });
          stats.forEach(function (r) {
            if (r.type === 'candidate-pair' && (r.id === pairId || (!pairId && r.nominated && r.state === 'succeeded'))) {
              const lc = stats.get(r.localCandidateId), rc = stats.get(r.remoteCandidateId);
              route = (lc ? lc.candidateType : '?') + ' - ' + (rc ? rc.candidateType : '?');
              if (typeof r.currentRoundTripTime === 'number') rtt = ' / 遅延 ' + Math.round(r.currentRoundTripTime * 1000) + 'ms';
            }
          });
        } catch (_) {}
        const bad = pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed';
        const dd = rxDecoders.get(id);
        if (dd && dd.dbgLast && performance.now() - dd.dbgLast.at < 30000) diagLine(out, '　直近の音: ピーク ' + dd.dbgLast.peak + '（モールスには 100以上）/ 平均 ' + dd.dbgLast.avg + ' / 700Hz帯の割合 ' + dd.dbgLast.pure + '%（55%以上）/ ' + (dd.dbgLast.tone ? 'トーンと判定' : 'トーンではない') + ' / ' + Math.round((performance.now() - dd.dbgLast.at) / 1000) + '秒前 / ' + dd.dbgLast.sr + 'Hz');
        try {
          const el = document.getElementById('audio-' + id);
          const rcv = pc.getReceivers().filter(function (r) { return r.track && r.track.kind === 'audio'; });
          const snd = pc.getSenders().filter(function (r) { return r.track && r.track.kind === 'audio'; });
          const tr = pc.getTransceivers().filter(function (t) { return (t.receiver && t.receiver.track && t.receiver.track.kind === 'audio'); }).map(function (t) { return (t.direction || '?') + '→' + (t.currentDirection || 'なし'); });
          diagLine(out, '　音: 再生部品 ' + (el ? ((el.paused ? '停止' : '再生中') + (el.muted ? '・ミュート' : '') + '・トラック' + (el.srcObject ? el.srcObject.getAudioTracks().length : 0)) : 'なし（相手の音声が、届いていません）')
            + ' / 受信トラック ' + rcv.map(function (r) { return r.track.readyState + (r.track.muted ? '・無音' : ''); }).join(',') + (rcv.length ? '' : 'なし')
            + ' / 送信トラック ' + (snd.length ? snd.map(function (r) { return r.track.readyState + (r.track.enabled ? '' : '・停止中'); }).join(',') : 'なし')
            + ' / 向き ' + (tr.join(',') || '?') + ' / 送信 ' + (outB >= 0 ? Math.round(outB / 1024) + 'KB' : '?') + ' / 受信パケット ' + (inP >= 0 ? inP : '?'), '#94a3b8');
        } catch (_) {}
        diagLine(out, (meta && meta.name ? meta.name : id.slice(0, 5)) + ' : ' + pc.connectionState + ' / ice:' + pc.iceConnectionState + ' / 経路 ' + route + rtt + inb + ' / 話し中の合図: ' + (meta && meta.isTalking ? 'はい' : 'いいえ') + (id === currentTalkerId ? '（受信中）' : ''), bad ? '#f87171' : (pc.connectionState === 'connected' ? '#4ade80' : '#fbbf24'));
      }
      if (currentKey) {
        const have = new Set();
        peerMap.forEach(function (info) { have.add(String(info.name || '').slice(0, 12)); });
        const st1 = roomStats().get(currentKey);
        const miss = [];
        if (st1) st1.names.forEach(function (n) { const nn = String(n).replace('(自分)', ''); if (String(n).indexOf('(自分)') < 0 && !have.has(nn.slice(0, 12))) miss.push(nn); });
        if (miss.length) diagLine(out, '一覧にいるが、つながっていない人: ' + miss.join('、'), '#fbbf24');
      }
      if (window.pcCount) {
        diagLine(out, '接続の記録: 作成 ' + window.pcCount.created + ' / 破棄 ' + window.pcCount.closed + ' / 失敗 ' + window.pcCount.failed + '（直近の出来事は、下）');
        (function () {
          const bad = new Set();
          window.pcLog.forEach(function (l) { const m = /(#[0-9]+) (ice|conn):failed/.exec(l); if (m) bad.add(m[1]); });
          return window.pcLog.filter(function (l) { const m = /(#[0-9]+) /.exec(l); return l.indexOf('相手') >= 0 || l.indexOf('取り決め') >= 0 || l.indexOf('ICEエラー') >= 0 || (m && bad.has(m[1]) && (l.indexOf('失敗の詳細') >= 0 || l.indexOf('失敗のペア') >= 0 || l.indexOf('ice:failed') >= 0 || l.indexOf('作成') >= 0)) ; }).slice(-30);
        })().forEach(function (l) { diagLine(out, '　' + l, '#94a3b8'); });
      }
      diagBox.textContent = '';
      diagBox.appendChild(out);
    }
    const autoChk = document.getElementById('autoReconnect');
    autoChk.checked = autoReconnectOn;
    autoChk.addEventListener('change', function () {
      autoReconnectOn = autoChk.checked;
      try { localStorage.setItem('pochitalk_autoreconnect', autoChk.checked ? '1' : '0'); } catch (_) {}
    });
    const relayChk = document.getElementById('relayOnly');
    relayChk.checked = FORCE_RELAY;
    relayChk.addEventListener('change', function () {
      try { localStorage.setItem('pochitalk_relay', relayChk.checked ? '1' : '0'); } catch (_) {}
      setTimeout(function () { location.reload(); }, 200);
    });
    document.getElementById('diagBtn').addEventListener('click', function () {
      closeSettings(); // 設定を閉じて、メイン画面に出す
      diagStart();
    });
    diagAlwaysChk.addEventListener('change', function () {
      try { localStorage.setItem('pochitalk_diag_always', diagAlwaysChk.checked ? '1' : '0'); } catch (_) {}
      if (diagAlwaysChk.checked) diagStart();
      else { if (diagTimer) { clearInterval(diagTimer); diagTimer = null; } diagPanel.classList.remove('on'); document.body.classList.remove('diag-on'); }
    });
    try { if (localStorage.getItem('pochitalk_diag_always') === '1') { diagAlwaysChk.checked = true; setTimeout(function () { diagStart(); }, 1500); } } catch (_) {} // 画面の準備が終わってから始める
    document.getElementById('diagClose').addEventListener('click', diagStop);
    document.getElementById('diagCopy').addEventListener('click', function () {
      const btn = this;
      const lines = [];
      (diagBox.firstChild ? diagBox.firstChild.childNodes : []).forEach(function (n) { lines.push(n.textContent); });
      const text = lines.join(String.fromCharCode(10));
      const done = function (ok) { btn.textContent = ok ? 'コピーしました' : 'コピー失敗'; setTimeout(function () { btn.textContent = 'コピー'; }, 1800); };
      const fallback = function () {
        try {
          const ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta); done(ok);
        } catch (_) { done(false); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      else fallback();
    });

    document.getElementById('welcomeMicBtn').addEventListener('click', function () { openDialog(settingsDialog); });
    document.getElementById('welcomeAboutBtn').addEventListener('click', function () { openDialog(aboutDialog); });
    document.getElementById('welcomeClose').addEventListener('click', function () { welcomeDialog.close(); });
    // 初回案内の表示設定: オフにしたときだけ記録する（設定の中とダイアログのチェックは同じ値）
    const welcomeAgain = document.getElementById('welcomeAgain'), welcomeAgain2 = document.getElementById('welcomeAgain2');
    function getWelcomeOn() { try { return localStorage.getItem('pochitalk_welcome') !== 'off'; } catch (_) { return true; } }
    function setWelcomeOn(on) {
      try { if (on) localStorage.removeItem('pochitalk_welcome'); else localStorage.setItem('pochitalk_welcome', 'off'); } catch (_) {}
      welcomeAgain.checked = welcomeAgain2.checked = on;
    }
    welcomeAgain.checked = welcomeAgain2.checked = getWelcomeOn();
    welcomeAgain.addEventListener('change', function () { setWelcomeOn(welcomeAgain.checked); });
    welcomeAgain2.addEventListener('change', function () { setWelcomeOn(welcomeAgain2.checked); });
    document.getElementById('aboutBtn').addEventListener('click', function () {
      if (aboutDialog.showModal) aboutDialog.showModal(); else aboutDialog.setAttribute('open', '');
    });
    document.getElementById('aboutClose').addEventListener('click', function () { aboutDialog.close(); });
    aboutDialog.addEventListener('click', function (e) { if (e.target === aboutDialog) aboutDialog.close(); });

    // ---------- VOX（声を拾って自動で送信）----------
    const voxCheck = { checked: false }; // VOX が ON か（ボタンで切り替える）
    const voxBtn = document.getElementById('voxBtn'), voxState = document.getElementById('voxState');
    function setVoxUI(on) {
      voxCheck.checked = on;
      voxBtn.classList.toggle('on', on);
      voxBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      voxState.textContent = on ? 'ON' : 'OFF';
    }
    const voxPanel = document.getElementById('voxPanel');
    const voxFill = document.getElementById('voxFill');
    const voxThrEl = document.getElementById('voxThr');
    const voxSens = document.getElementById('voxSens');
    const VOX_HOLD_MS = 1200;   // 声が止んでからこの時間で送信終了
    const VOX_COOLDOWN_MS = 700; // 終了音を拾って再送信しないための待ち
    let voxAnalyser = null, voxTimer = null, voxBuf = null;
    let voxBusyHits = 0, voxBusyAt = 0, voxBusyBeepAt = 0;
    let voxHits = 0, voxLastVoice = 0, voxCooldownUntil = 0, voxInitiated = false;

    function voxThreshold() { return 0.02 + (parseInt(voxSens.value, 10) - 1) * 0.007; }
    function updateVoxThrMarker() { voxThrEl.style.left = Math.min(100, voxThreshold() / 0.2 * 100) + '%'; }

    function voxTick() {
      if (!voxAnalyser) return;
      voxAnalyser.getFloatTimeDomainData(voxBuf);
      let sum = 0;
      for (let i = 0; i < voxBuf.length; i++) sum += voxBuf[i] * voxBuf[i];
      const lvl = Math.sqrt(sum / voxBuf.length);
      const thr = voxThreshold();
      voxFill.style.width = Math.min(100, lvl / 0.2 * 100) + '%';
      voxFill.classList.toggle('over', lvl > thr);
      if (!room) { voxHits = 0; return; }
      const now = Date.now();
      if (!isTransmitting) {
        if (!startPending) voxInitiated = false;
        // 他の人が話している間は割り込まない
        if (lvl > thr && othersTalking() === 0 && now > voxCooldownUntil && !startPending) {
          if (++voxHits >= 3) {
            voxHits = 0;
            voxInitiated = true;
            voxLastVoice = now;
            pressed = true;
            startTransmission(true);
          }
        } else if (lvl > thr && othersTalking() > 0) {
          // 相手が話している間に、声を出した: 話中の音で知らせる（最初の0.15秒の声は無視。2.5秒に1回まで）
          if (++voxBusyHits >= 3 && now > voxBusyBeepAt) {
            voxBusyHits = 0; voxBusyBeepAt = now + 2500;
            playBusyTone(); flashSub('話中です（相手が話しています）');
          }
        } else if (lvl <= thr) { voxHits = 0; voxBusyHits = 0; }
      } else if (voxInitiated) {
        if (lvl > thr) voxLastVoice = now;
        else if (now - voxLastVoice > VOX_HOLD_MS) {
          pressed = false;
          voxInitiated = false;
          stopTransmission();
          voxCooldownUntil = Date.now() + VOX_COOLDOWN_MS;
        }
      }
    }

    async function startVox() {
      getAudioContext();
      const ok = await initMicrophone();
      if (!ok || !txAnalyser) { setVoxUI(false); return; }
      voxAnalyser = txAnalyser; // 入力レベル調整後の音量で判定する
      voxBuf = new Float32Array(voxAnalyser.fftSize);
      voxPanel.classList.remove('hidden');
      updateVoxThrMarker();
      voxTimer = setInterval(voxTick, 50);
    }

    function stopVox() {
      clearInterval(voxTimer); voxTimer = null;
      voxAnalyser = null;
      voxPanel.classList.add('hidden');
      voxFill.style.width = '0';
      if (voxInitiated && isTransmitting) { pressed = false; stopTransmission(); }
      voxInitiated = false;
    }

    voxBtn.addEventListener('click', function () {
      if (!voxCheck.checked) { setVoxUI(true); startVox(); }
      else { setVoxUI(false); stopVox(); }
      voxBtn.blur();
    });
    try {
      const savedSens = parseInt(localStorage.getItem('pochitalk_vox_thr'), 10);
      if (savedSens >= 1 && savedSens <= 10) voxSens.value = savedSens;
    } catch (_) {}
    voxSens.addEventListener('input', function () {
      updateVoxThrMarker();
      try { localStorage.setItem('pochitalk_vox_thr', voxSens.value); } catch (_) {}
    });

    // ---------- 音声レベル（部屋の中・ホームのマイクテスト共通）----------
    function makeMeter(canvas, dbEl, labelEl, dimIdle) {
      const lv = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height, SEGS = 24;
      let level = 0, peak = 0, peakHoldUntil = 0, td = null;
      return function (src) {
        let target = 0, db = -Infinity;
        if (src) {
          if (!td || td.length !== src.an.fftSize) td = new Uint8Array(src.an.fftSize);
          src.an.getByteTimeDomainData(td);
          let sum = 0;
          for (let i = 0; i < td.length; i++) { const v = (td[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / td.length);
          db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
          target = Math.min(1, Math.max(0, (db + 60) / 60));
        }
        level += (target - level) * (target > level ? 0.5 : 0.12);
        const now = performance.now();
        if (level >= peak) { peak = level; peakHoldUntil = now + 800; }
        else if (now > peakHoldUntil) peak = Math.max(level, peak - 0.02);
        lv.clearRect(0, 0, W, H);
        const sg = 3, sw = (W - sg * (SEGS - 1)) / SEGS;
        for (let i = 0; i < SEGS; i++) {
          const pos = (i + 1) / SEGS;
          const on = pos <= level + 0.001;
          const isPeak = Math.abs(pos - peak) < 0.5 / SEGS + 0.001 && peak > 0.02;
          // 話してもいない・受信してもいない（マイクの待機表示）ときは、点灯を薄くして差をつける
          const lit = (dimIdle && src && src.idle) ? 0.38 : 1;
          lv.globalAlpha = (on || isPeak) ? lit : 0.16;
          lv.fillStyle = pos > 0.85 ? '#ef4444' : pos > 0.65 ? '#fbbf24' : '#10b981';
          lv.fillRect(i * (sw + sg), 0, sw, H);
        }
        lv.globalAlpha = 1;
        dbEl.textContent = isFinite(db) ? Math.round(db) + ' dB' : '-∞ dB';
        if (labelEl) labelEl.textContent = !src ? 'LEVEL' : (src.idle ? 'MIC' : (isTransmitting ? 'TX' : 'RX'));
      };
    }

    (function () {
      const roomMeter = makeMeter(document.getElementById('levelCanvas'), document.getElementById('levelDb'), document.getElementById('levelLabel'), true);
      const homeMeter = makeMeter(document.getElementById('homeLevelCanvas'), document.getElementById('homeLevelDb'), null);
      const radioView = document.getElementById('radioView');
      const homeView = document.getElementById('homeView');

      function pickSource() {
        if (isTransmitting && txAnalyser) return { an: txAnalyser };
        if (currentTalkerId && rxAnalysers.get(currentTalkerId)) return { an: rxAnalysers.get(currentTalkerId) };
        if (txAnalyser) return { an: txAnalyser, idle: true };
        return null;
      }

      function draw() {
        requestAnimationFrame(draw);
        if (!radioView.classList.contains('idle')) roomMeter(pickSource());
        else homeMeter(micTest && txAnalyser ? { an: txAnalyser, idle: true } : null);
      }
      requestAnimationFrame(draw);
    })();

    // ---------- 入力レベル（マイクの増幅 0〜30dB）----------
    const homeGain = document.getElementById('homeGain');
    const homeGainVal = document.getElementById('homeGainVal');
    function setInputDb(v, save) {
      inputDb = Math.min(30, Math.max(0, parseInt(v, 10) || 0));
      homeGain.value = inputDb;
      const label = inputDb === 0 ? 'そのまま' : '+' + inputDb + ' dB';
      homeGainVal.textContent = label;
      if (micGain) micGain.gain.value = Math.pow(10, inputDb / 20);
      if (save) { try { localStorage.setItem('pochitalk_input_db', String(inputDb)); } catch (_) {} }
    }
    try { setInputDb(localStorage.getItem('pochitalk_input_db'), false); } catch (_) { setInputDb(0, false); }
    homeGain.addEventListener('input', function () { setInputDb(homeGain.value, true); });

    // ---------- スピーカーミュート（相手の声と効果音を止める。マイクは止めない）----------
    const speakerBtn = document.getElementById('speakerBtn');
    function applySpeakerMute() {
      document.querySelectorAll('audio[id^="audio-"]').forEach(function (a) { a.muted = speakerMuted; });
      if (sfxGainNode) sfxGainNode.gain.value = speakerMuted ? 0 : sfxVol;
      speakerBtn.textContent = speakerMuted ? '🔇' : '🔈';
      speakerBtn.setAttribute('aria-pressed', speakerMuted ? 'true' : 'false');
      speakerBtn.classList.toggle('muted', speakerMuted);
    }
    speakerBtn.addEventListener('click', function () {
      speakerMuted = !speakerMuted;
      applySpeakerMute();
      flashSub(speakerMuted ? 'スピーカーをミュートしました' : 'スピーカーのミュートを解除しました');
    });

    // ---------- 話すボタンの位置（左 / 中央 / 右）----------
    // 中央のときだけ、左手用で VOX ボタンの側を切り替える。左寄せ→VOX は右側、右寄せ→VOX は左側
    const pttPosSeg = document.getElementById('pttPosSeg');
    function setPttPos(pos, save) {
      if (pos !== 'left' && pos !== 'right') pos = 'center';
      document.querySelector('.ptt-wrap').classList.toggle('pos-left', pos === 'left');
      document.querySelector('.ptt-wrap').classList.toggle('pos-right', pos === 'right');
      pttPosSeg.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-pos') === pos); });
      if (save) { try { if (pos === 'center') localStorage.removeItem('pochitalk_ptt_pos'); else localStorage.setItem('pochitalk_ptt_pos', pos); } catch (_) {} }
    }
    pttPosSeg.addEventListener('click', function (e) {
      const b = e.target.closest('.seg-btn');
      if (b) setPttPos(b.getAttribute('data-pos'), true);
    });
    try { setPttPos(localStorage.getItem('pochitalk_ptt_pos'), false); } catch (_) { setPttPos('center', false); }

    // ---------- 左手用（VOX ボタンの位置）----------
    const leftyCheck = document.getElementById('leftyCheck'), pttWrap = document.querySelector('.ptt-wrap');
    function setLefty(on, save) {
      leftyCheck.checked = on;
      pttWrap.classList.toggle('lefty', on);
      if (save) { try { if (on) localStorage.setItem('pochitalk_lefty', '1'); else localStorage.removeItem('pochitalk_lefty'); } catch (_) {} }
    }
    try { setLefty(localStorage.getItem('pochitalk_lefty') === '1', false); } catch (_) { setLefty(false, false); }
    leftyCheck.addEventListener('change', function () { setLefty(leftyCheck.checked, true); });

    // ---------- 効果音の音量 ----------
    document.getElementById('testRoomBtn').addEventListener('click', function () { closeSettings(); tuneKey('7a0b07c1'); });
    const sfxVolEl = document.getElementById('sfxVol'), sfxVolVal = document.getElementById('sfxVolVal');
    function setSfxVol(v, save) {
      const n = Math.min(150, Math.max(0, parseInt(v, 10)));
      sfxVol = isNaN(n) ? 1 : n / 100;
      sfxVolEl.value = Math.round(sfxVol * 100);
      sfxVolVal.textContent = Math.round(sfxVol * 100) + '%';
      if (sfxGainNode) sfxGainNode.gain.value = speakerMuted ? 0 : sfxVol;
      if (save) { try { localStorage.setItem('pochitalk_sfx_vol', String(Math.round(sfxVol * 100))); } catch (_) {} }
    }
    try { const sv = localStorage.getItem('pochitalk_sfx_vol'); setSfxVol(sv === null ? 100 : sv, false); } catch (_) { setSfxVol(100, false); }
    sfxVolEl.addEventListener('input', function () { setSfxVol(sfxVolEl.value, true); });
    sfxVolEl.addEventListener('change', function () { getAudioContext(); playPttEndTone(); }); // 離したら試し聴き

    // ホームのマイクテスト（入室しなくても、入力レベルとメーターを確認できる）
    const micTestBtn = document.getElementById('micTestBtn');
    function endMicTest() { micTest = false; micTestBtn.textContent = 'マイクテスト開始'; }
    micTestBtn.addEventListener('click', async function () {
      if (micTest) { endMicTest(); if (!room) releaseMic(); return; }
      micTest = true;
      micTestBtn.textContent = 'マイクテスト停止';
      const ok = await initMicrophone();
      if (!ok) endMicTest();
    });

    document.getElementById('leaveBtn').addEventListener('click', function () { leaveRoom(); });
    document.getElementById('leaveBtn2').addEventListener('click', function () { leaveRoom(); });

    // 液晶が画面外にスクロールしたら、上部にルームハッシュのバーを出す
    (function () {
      const bar = document.getElementById('stickyBar');
      const lcd = document.querySelector('.lcd');
      const radioView2 = document.getElementById('radioView');
      if (!('IntersectionObserver' in window)) return;
      new IntersectionObserver(function (entries) {
        const visible = entries[0].isIntersecting;
        const inRoom = !document.getElementById('radioView').classList.contains('idle');
        bar.classList.toggle('hidden', visible || !inRoom || radioView2.classList.contains('flipped'));
      }).observe(lcd);
    })();

    document.getElementById('shareBtn').addEventListener('click', function () {
      if (!currentKey) return;
      const url = location.origin + location.pathname + '?r=' + currentKey;
      const done = function () { flashSub('招待URLをコピーしました'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { prompt('招待URL', url); });
      } else { prompt('招待URL', url); }
    });

    nameInput.addEventListener('input', function () {
      myNickname = nameInput.value.trim() || 'NoName';
    });
    nameInput.addEventListener('change', function () {
      myNickname = nameInput.value.trim() || 'NoName';
      try { localStorage.setItem('pochitalk_ptt_name', myNickname); } catch (_) {}
      if (sendNickname) sendNickname(myNickname);
      announce();
      renderScan();
    });

    // 招待URLで開いたときは、招待の画面を優先して、初回案内は出さない（設定からいつでも見られる）
    if (getWelcomeOn() && !isKey((urlParams.get('r') || '').trim().toLowerCase())) openDialog(welcomeDialog);

    (async function init() {
      const p = (urlParams.get('r') || '').trim().toLowerCase();
      pendingKey = isKey(p) ? p : null;
      renderFreq(null);
      await refreshIceServers();
      setInterval(function () { refreshIceServers(false); }, 5 * 60 * 1000); // 通話中も資格情報を新しく保つ
      rejoinAfterReload();
      joinLobby();
      renderScan();
    })();
  </script>
</body>
</html>`;

// ---- アイコン類（線画）。PNGはbase64で埋め込み ----
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">\n  <rect width="64" height="64" rx="14" fill="#1a1e24"/>\n  <g fill="none" stroke="#60a5fa" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">\n    <rect x="18" y="19" width="24" height="39" rx="5"/>\n    <path d="M25 19V8"/>\n    <path d="M24 28h12"/>\n    <circle cx="30" cy="45" r="5.5"/>\n    <path d="M47 24q4 6 0 12"/>\n    <path d="M53 19q7 11 0 22"/>\n  </g>\n</svg>';
const PNG_FAVICON = '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';
const PNG_APPLE = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAQAElEQVR4nOydCXSUVZbHb+2pSqpSVUklpLKRBUgIWwiLYbEVF8QRFRyXFkTonunFkdaRsXW6W08rY0+PM4r2KIO4zWmxwWZpkAZFVDabJawBQgJJCEllgSyVSlVSe6X6BfrQOSTf/Wr5Qn3fl/c7ORxOvZulkv/33n333Xev3JyVDxTKYEiBQmGAioPCCBUHhREqDgojVBwURqg4KIxQcVAYoeKgMELFQWGEioPCCBUHhREqDgojVBwURqg4KIxQcVAYoeKgMCIHEZGYOTEhbbQiTu/qarLVHffYrwAlCkQiDolMMWbe81kzF19/xeu0nfnshY4LB4ASKSJZVgrm/6K/MghKjb74ydXa9LFAiRQxiEOXPi5z+qMDX5dKZUULV5JpBSgRIQZxpI6/i2lIZy7UmHKAEhFiEEdi5iRkVJc2BigRIQqHNBhEBqVyFVAigsY5KIxQcVAYoeKgMELFQWGEioPCCBUHhREqDgojVBwURqg4KIxQcVAYoeKgMELFQWGEioPCCBUHhREqDgojVBwURqg4KIxQcVAYoeKgMELFQWGEioPCCBUHhREqDgojVBwURgR5qSlOb05IHSVX6xRXP9SGdMQ4pegOtTEduCbg8/pddr/b7nXauyynAp4euLmkT3vYmFcqkUBb5d6Wk5/DECARUDMeooYRE+5Nm3SfPrtYIul3PToY48vSAZ+nrXJPS/mO9vP7gwEfDDEqXWrxk6t15sLrr3i7rafWPW2rPwWcIgxxEFnk3PajrNJFMsVgdxtjLY7ruO2ttV+/03RsCwR7YWggyrjl6U0qbdINr/tcjrLVj/W01wF3yLSJRuA32bOXTXr87aT8W6Qy5kWQH+KQq+JTCm9PnTDP2WFxdTTAEJB359PJo0oHvk4eG1362D5dcgevxaHSpZQsW5sx9aHBJ4z+8KkGhzLeYC6eL483WGsOcT6FjF3wa+JmDToUp0+zN51ztl8CjuDvbsWYd0vp8i3EvQBhkl36+PSnNsQlpgGnyJQaZHT0vc+DhLO/KU/FYciZUvKD95UJoc1q+LQRhFhBfEaiD6U2GbjD292BjMabRmZOexQ4go/i0CRlFS9ZLZHKQPiodKbJS9+TyBTAES3lO3GD/LuXyxRq4ALe+RwyVfz0n65Xhfu0DbphCUJQApJYuyMqrSnelHPlzC7gAmdH/cjZyxADmSKOvGdr7WGIGt6Jo/CBl5PypkOYEBFcWz7+LoVgECQxF8bfSEjN726t6WmthagJeJ0glRpzpiI2uvRxzcf/FH1cjl9xDk3yyFkrdoZoHPC57Y1nbZbTvT7XtVfI7K3Wp5OgiLurxetog6FEoTESZ1lnLgjR3mlt+O6/7wEuIO9y1s+/UiUkITbNJ7af3fgCRAe/wuej5j4billH7ZHqL9+0N56BWCOVq5LyZxTc/0u1wYxbaoxZGdMfazyyAaIm4HPV7P5d0YJXEJu04vtqdr/ltrVAFPBoWSFe/biH/gO3IbPF+Z2vV25b6bW3Ag8I9gZIXKHx6CbyHOvYCuKSMyDL4fXABY7myhET/kEZr2cyICuq3+vqvHgEooBHu5WUsXey2pT93+OWg+v4VnW21+us2PJS5eev4WbE81Abs4ATgsHzO36Lm/QV7o3O6eKVOObgBhe+fNPRUgV8xXLo0w62PQLTe9Sk5JmnPpR357+kFc+H0CCHfNZabGIggdpQnjcEviwrZPEuemilhDm6Z2+qOLvpF8BvrNUHM6Y+LJUrmQzIOQDZR/R/RarUlCx7f8y9z6cUzjHmTkstuitz5mJ7Y4WrsxHYcHW2pJc8iBjI47Qtp7ZDpPBl5tCmFeBRr7p9H+DFaPmAx9F2ufwLxEDb75z9GlN+8KExb1r/V5TqxElPvDPQciCddWU9bZcQg6RRM8mBC0QKX8ShiDfgBl0N5SAEuizYz0mObfvPKyP6clMmDmamGf/If4VyStJY9hkyStzSjOmRR9P5Ig7yuCCj3p5Od9dlEAI2C4uISSjm+v/TJz/AZEa811BOSZqObu71exEDssxJpBEGLPgiDjnDMfQ1bAKZNgisYVC55u/vVI4+EvlzfyaPw34tBL+n+/JpLDBP3FLT2DsgIvizW0E3Xb1+EA4+lwMZlfZ7jgNeF2KpUCfm3/0MsGFBVxYIYRvIBM0+jyUkeoYbZN7yWHxKHm7TVX8Cd0sNkebEUHHEksuntpMzF8SAeJS5c54CNlrKdyCjamOGQqOH8KHiiDFV21kCnanj7mT909ouHcMNDLlhH3QDFUfMaa/a21F9EDGQyhTpUx8GFFv9yd4A5pYZsrFmVkyIpHVonCFdpUuVSof87fT63a7OJjxXL1zObX111oodSAyQnJJc2vc+YD+Vt8ty2jByMpNBYkRuh+DFocsYP3HRKrXeDDcR68Wjp9ev8Ha3Axe4rA0t5TvNzKcqaoM5afRsvEduZ91RRBw6cyE5oOj1eyAchL2sZJYumvrjT26yMgjG3KmlP9tsyJkCHGE5wrIdTWU7QiN6RUbJ2pSYOQHCRMDikMgU2TMXy5hPuYYUldZkLlkIHMG6HdWPZFkXiE+Kux0a00gIEwGLI3nMrZqkbIgd5uL7OWw9efk0th0l0XSZKh4x6O3L7WlCDJSasI/fBSwOfVbY8yS3SKTSxMyJwBEd1Sy5IMacabiBt9uKjCJpY0wIWBwuazPEGg9HPin0HeeeCvgwh5H18h/uICvih9PMYW+qgJji9/Q42y4CRwR7A2THgRjEszkN3h585mBJihiIoMVxtun4VogdVWxJo+HSjZ7o4ke40JdqhM0cw8vnIFRue7X7Sg3EAqLL5hMcS9PX04mM4lkNVz8dmzkU4fscwg6C9frcB9+6X5tWYCqco8+edBPa1vucts66Y1fOfuWxXwGuIV8cGVWyicODOqSq8O9ziyF87mip4nNWeugEo6wIwHUtEJGcrYgDRRw283udXYDSP8dsIB500Rn8CwKFNyjQv67PxSIOPA/Xx6atgVBx8Ag8bwP3SOBqWiEy6qfiEDR4RqDfaQcUfDvjdWJbocG/IFD4gYw8+BnjEIOedpaAm0KDzxws2hoIFQdfMORNx2pp9mVsHAcUhRp3WVhWpYFQcfCF1PFzkVFy7GJvZjkuYNvsUHEIE3IcnzZhHmLQl0KMXxWWSDQmLIGBOqRCxVyyQIpmLVnZ1hRd+jg5mvDB6rIMhIqDF2TPWIQbXEZvpsDVzEVklKxKXZawq2RRccQe09g78ZQ2a91Rl9UCKAa0vqCt4VSwNwBhQsURYyRSecH8F3Eb1vRj4nDg2c6st54GhYojxmTPWoJnz5PAaCtbgVuduQh3OMhJMoQPFUcsITHN3Dk/xW0aj25kXRFuqA10A70Bv63+JIQPFUcsyZj2KP7E+z09l/Z/DGykjLsbGbU3VuAFXpig4oglKUUsZVVqv36X9byNnMjo0QtLeGoqAhVHLJGgJWucVkvDwXXARvaMJbhB67lvICLoLftYgm9Qz215OchW0kiqiEsrvg8xcHbUd1kiLJpFxRFLLEf+yDREHne8Bu010ksWyJRYd5X6g59CpFBxxJLOurJBYxhkQanY/CsIgcxbvo+MEj/0hpq4YUHFEWMqt75yce/a/q+0Ve0/unZpKFl9idmTE1KxjiiXz+yKpuvKMHJIpUpNUu50Xeb4+KQsld6sNqTF6VKd1gZXZ4vb1tzTdomEESOLB0RJza63Gss2qvV9bbNdnY3khwnxE0ff8xxu0MRWkA5H/OIgLlvWjCdMBbcZBqtioDFmafp1MiBxBWtd2eVTO1kPurjF3dnkRu/ID8RUOAep1kJw2Zoj3sReQ+TiGDHpvlFzn1PrR4Ro39c1uOB28kH0VLntVUfzOeAl5ESm8P5f4jaWQ3+A6BCtOOIMGeMffT2yQmlwtb5D6fJNjce2VH3+2vU2Yfwhe/YyvOI9CZk3HdsM0SFOhzRp9OwZz/wpYmVcJ2PKQiIRtTET+IRSm5w35ye4DXFiIriocgNiE0ewr7HqM5OXrsHPLEIn3pRTunxzcsH3gDeMvud5PLZBPKear96GqBGbOAruezH39h9z2zNUHpdQvGS1qfB24AFac6F5Mks3p9qv3/G7w76IMBBRicNcsiB75hIYAojaJnz/DdYy5DeBLLY3SDYpDVFERfsjHnEkZk0sWvgqDBkyRVzJsrWK8OvjcItpzK24QdW23wQ5ajIhEnFIZIqJi97GG4FFD9kgFNz/EsSUYC9WZ6Gz7lhb1bfAESLZyo4kWztdSiiWAZ+n+0q1o7mK/OvsaCDhZ525UJs2JsQlI23CPfUHPo5hv2Nvj1WlZexFXbltJXCHGMQhj9MRJ5TVLBgMWg5vuPDF//SPW7Sf33ftP3F6c19cBI05XoP4vGVrFkGMIBHxgvn/PuhQY9kmonjgDjEsK2Tvim/tCG5by7H3l1Z9vpIpokVONMreW1y5/Td49yS4WvIxZdxciBGNRzdaBwuKO1ouXPjideAUMYgjfcoC3MBxpea7VfNZDxrI9tdycN2hdx8BNjKjaLkYJb0+97G1T9bt+9Dbr5ZL67lvjn/0Q7+7GzhF8MuKMb+U7CMQAxJIPrPh33q9TggNZ2stWbkLH8AcT0POFOICBwM+iBHVX75BPlKK7lIlJLdV7Rmi1pmCnzmS8kpxAxIR6r58AcLBcng93nhcKpMb2IpN3wRaK3ZbjqwfuqaqgheHLh3r3GxvqqhD29gwcfazF/zoZKMzF4DYEbw4VLpUZLSBHFtH1OTc42hrO7cHMVAlhrRzFjSC9zlUOixXw9nBcv8Y/dx6ZDQOFaU4ELY4pIo4hToBMWC9nI6Ai0NFxcFzlAksJZujKULtsbcho8rwO1QIDmH7HH62uq0aUy5EiiZ5JDLq93AcVOAhAheH24FfEdaljYFI0aVh+yCvg7M2PLxF8LsVvMmINooNpxbdJLsd2KIjDgQvDrz/r7n4QSkaP2UiIXWULr0IsO9LZw7e09V4FhlV6Uw5t/0IwqfoH1/Dcw27LNj3FQeCFwcJIeMGOd/7odqQAeGQXrIQrzQd8Lnx/tDiQPDisF4sw08jpTLF2IWvQMjI47Sj5q3AbdrP7w+39bcQEf6RfbC34TDL1a6k/NJJT7zD2kAPrlbJmfaTT1kbKdZ/93sYBoghn+PS3g98bgdukzJ2zqzndiSNns1oIZXlznmqdPkW/N46ob36kK3+BAwDxJAmSOJRl/Z9OGrus7iZMsFYsuw9V2ezraHc1nCS/IGd7fXEt0jMKtZnTdJnT8Yj8dep2bUKhgciSTBu+Msn2bOWhtKRW20wk4+0ifMgIlorv7U3iX+fcg2RXE0I+FynN6zA0/ajh5zjn9vyaxg2iOdSk7XmUNWO38KQQbavxz/65+EQ+7qOqK5DWg6uazq2BYaAYDBY/od/DTfdUOiI7SL12c2/qtsbSV4gQsDrOvXJ8vaqfTDMEJs4SMS7eteq0xt+HllBl2TX2wAAA0tJREFU54G47a1HVj/aVsnZHUMBIc7iLZfL/1y2ZrG3J+yuZjfQ1Xjm8O8Wdl+pgWGJaMs+kQ3nX96YlzVrSVbpEyEGMPrT09FQt+e95hPbOG8QLyDEXDDO5+qq3f2/9Qf+P7N0kXnyA/HJ2aF8lvXi0eYTW6Op7SoaxF9q0u921O1ZQz7IucmI8fcYcqYqEoxyVYJCrZWr4n1Ou99t97m7PfbW1nNfX6n4xh9+52axMoyK1Pa01tZ+8y5QQoaWt6YwwpeZw+/DSnQrE0wgEKRyFVvzpVCvdMccvswcPocVGdWmjQZOCwQOHbr0QokU+626beGVsY4hfBGHBz2zkCnVmuQcEAJa81hk1O/piaC/a6zgizjwJHLoq9DyEAiBjKkPI6MeQd124Ys43LZmbw+2h8yeuVjdr70BP8mY9ogWvUblaKoA4cCj3UrrOez8oi9P+MGXgcf0ZSazNUCJuBdfTOCVOFh+cUmjZmTNGJICxZwwduErCrUOt2k7L6QLDTwSR/v5/W5bC25TMP/FSUve5dsN94QRY2Y+t4OEX3GzxmNbAoK6fi3TJvLnFx309HSmjrsLN4o35ZgnP9i3zMQbyabR12OFWCBTJRD3wpA7zVyyYPwj/6kMoez1qU+W+9my5HmFxJyVD/xBIpn57Pb4lMjrJvCWhoOfVm1/DQQFz8LnwWA1F41C+EbA57m4Zw0IDd6drbRW7G4+vhVERDAYPPvHF1kDOTyEVz7H32it3KPPLtbwrHlWxFR/+WbT0Y0gQPgoDvKwXTm7Wz9ystqQDgKnbu8HF79dDcKEn+KAYK+/5eT2uMQROnMhCJPegL9iy0v1Bz4GwcJTcfQRDLZVfutz2Y2jZkgkAss78fbYjn/0T+1Ve0HI8FgcV+mynCYuanxKvlCWGDJhWMo+K1/3jLPjEggcnsU5mEkec2vuHU/pMycAjyGuUvWuVc72SyAKBCOOa5CoKDlhSSm4LWHEaLUxU6ZQQUzxurpcHZauhvL2CwestUdEVu5HYOK4AaXWpDaYpbIYSMTvcTg7LMI6KwkXYWefex1t3mFQDzRW0OxzCiNUHBRGqDgojFBxUBih4qAwQsVBYYSKg8IIFQeFESoOCiNUHBRG/goAAP//PYc+XQAAAAZJREFUAwDjF1ncj91IrwAAAABJRU5ErkJggg==';
const PNG_OG = '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';

function bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const CACHE = 'public, max-age=86400';

// ---- 版の表示（画面の下、設定、ボット、/version は、すべてこの1か所から出す）。更新のたびに、ここを変える ----
const APP_VERSION = '2026-11-10-z12q4（Trystero 0.25.4・接続準備 8）';
// ---- Trystero 0.25.4（MIT License, (c) Dan Motzenbecker）を、この Worker から配信する。外部の配信元（esm.sh）の遅れや停止に左右されないため ----
// 通話の部品 Trystero 0.25.4 の同梱版。1か所だけ書き換え: 部屋に入るときに先に作る接続の数（定数 bo）を 20 から 8 に減らした（8人の部屋の相手は最大7人）。
// 同時に出る STUN/TURN への問い合わせを減らす試験。取り込みのURLを -p8 にしたのは、古い版が1年キャッシュされるため
const TRYSTERO_B64 = 'LyogZXNtLnNoIC0gdHJ5c3Rlcm9AMC4yNS40L25vc3RyICovCnZhciBTdD1PYmplY3QuZnJlZXplKHtwOjB4ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmVmZmZmZmMyZm4sbjoweGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZlYmFhZWRjZTZhZjQ4YTAzYmJmZDI1ZThjZDAzNjQxNDFuLGg6MW4sYTowbixiOjduLEd4OjB4NzliZTY2N2VmOWRjYmJhYzU1YTA2Mjk1Y2U4NzBiMDcwMjliZmNkYjJkY2UyOGQ5NTlmMjgxNWIxNmY4MTc5OG4sR3k6MHg0ODNhZGE3NzI2YTNjNDY1NWRhNGZiZmMwZTExMDhhOGZkMTdiNDQ4YTY4NTU0MTk5YzQ3ZDA4ZmZiMTBkNGI4bn0pLHtwOnZlLG46emUsR3g6SnIsR3k6VnIsYjpidH09U3QscmU9MzIsTmU9NjQsYm49e3B1YmxpY0tleTpyZSsxLHB1YmxpY0tleVVuY29tcHJlc3NlZDpOZSsxLHNpZ25hdHVyZTpOZSxzZWVkOnJlK3JlLzJ9LEY9KGU9IiIsbj1FcnJvcik9PntsZXQgdD1uZXcgbihlKSx7Y2FwdHVyZVN0YWNrVHJhY2U6b309RXJyb3I7dGhyb3cgdHlwZW9mIG89PSJmdW5jdGlvbiImJm8odCxGKSx0fSxHcj1lPT5lIGluc3RhbmNlb2YgVWludDhBcnJheXx8QXJyYXlCdWZmZXIuaXNWaWV3KGUpJiZlLmNvbnN0cnVjdG9yLm5hbWU9PT0iVWludDhBcnJheSImJmUuQllURVNfUEVSX0VMRU1FTlQ9PT0xLGZlPShlLG4sdD0iIik9PntsZXQgbz1HcihlKSxpPWU/Lmxlbmd0aCxzPW4hPT12b2lkIDA7aWYoIW98fHMmJmkhPT1uKXtsZXQgcj10JiZgIiR7dH0iIGAsYT1zP2Agb2YgbGVuZ3RoICR7bn1gOiIiLGM9bz9gbGVuZ3RoPSR7aX1gOmB0eXBlPSR7dHlwZW9mIGV9YCx1PXIrImV4cGVjdGVkIFVpbnQ4QXJyYXkiK2ErIiwgZ290ICIrYztyZXR1cm4gbz9GKHUsUmFuZ2VFcnJvcik6Rih1LFR5cGVFcnJvcil9cmV0dXJuIGV9LEZlPWU9Pm5ldyBVaW50OEFycmF5KGUpLFR0PShlLG4pPT5lLnRvU3RyaW5nKDE2KS5wYWRTdGFydChuLCIwIiksUnQ9ZT0+e2xldCBuPSIiO2ZvcihsZXQgdCBvZiBmZShlKSluKz1UdCh0LDIpO3JldHVybiBufSx5ZT17XzA6NDgsXzk6NTcsQTo2NSxGOjcwLGE6OTcsZjoxMDJ9LGd0PWU9PmU+PXllLl8wJiZlPD15ZS5fOT9lLXllLl8wOmU+PXllLkEmJmU8PXllLkY/ZS0oeWUuQS0xMCk6ZT49eWUuYSYmZTw9eWUuZj9lLSh5ZS5hLTEwKTp2b2lkIDAsQXQ9ZT0+e2xldCBuPSJoZXggaW52YWxpZCI7aWYodHlwZW9mIGUhPSJzdHJpbmciKXJldHVybiBGKG4pO2xldCB0PWUubGVuZ3RoLG89dC8yO2lmKHQlMilyZXR1cm4gRihuKTtsZXQgaT1GZShvKTtmb3IobGV0IHM9MCxyPTA7czxvO3MrKyxyKz0yKXtsZXQgYT1ndChlLmNoYXJDb2RlQXQocikpLGM9Z3QoZS5jaGFyQ29kZUF0KHIrMSkpO2lmKGE9PT12b2lkIDB8fGM9PT12b2lkIDApcmV0dXJuIEYobik7aVtzXT1hKjE2K2N9cmV0dXJuIGl9LGh0PSgpPT5nbG9iYWxUaGlzPy5jcnlwdG8/LnN1YnRsZT8/RigiY3J5cHRvLnN1YnRsZSBtdXN0IGJlIGRlZmluZWQsIGNvbnNpZGVyIHBvbHlmaWxsIiksVWU9KC4uLmUpPT57bGV0IG49MDtmb3IobGV0IGkgb2YgZSluKz1mZShpKS5sZW5ndGg7bGV0IHQ9RmUobiksbz0wO2ZvcihsZXQgaSBvZiBlKXQuc2V0KGksbyksbys9aS5sZW5ndGg7cmV0dXJuIHR9LE1uPShlPXJlKT0+KGdsb2JhbFRoaXM/LmNyeXB0bykuZ2V0UmFuZG9tVmFsdWVzKEZlKGUpKSxUbj1CaWdJbnQsQmU9KGUsbix0LG89ImJhZCBudW1iZXI6IG91dCBvZiByYW5nZSIpPT50eXBlb2YgZSE9ImJpZ2ludCI/RihvLFR5cGVFcnJvcik6bjw9ZSYmZTx0P2U6RihvLFJhbmdlRXJyb3IpLEU9KGUsbj12ZSk9PntsZXQgdD1lJW47cmV0dXJuIHQ+PTBuP3Q6bit0fSxvbj1lPT5FKGUsemUpLFpyPShlLG4pPT57KGU9PT0wbnx8bjw9MG4pJiZGKCJubyBpbnZlcnNlIG49IitlKyIgbW9kPSIrbik7bGV0IHQ9RShlLG4pLG89bixpPTBuLHM9MW4scj0xbixhPTBuO2Zvcig7dCE9PTBuOyl7bGV0IGM9by90LHU9byV0LGw9aS1yKmMsZj1zLWEqYztvPXQsdD11LGk9cixzPWEscj1sLGE9Zn1yZXR1cm4gbz09PTFuP0UoaSxuKTpGKCJubyBpbnZlcnNlIil9LEV0PWU9PntsZXQgbj10b1tlXTtyZXR1cm4gdHlwZW9mIG4hPSJmdW5jdGlvbiImJkYoImhhc2hlcy4iK2UrIiBub3Qgc2V0Iiksbn0scHQ9KGUsbix0KT0+ZmUoRXQoZSkobix0KSxyZSwiZGlnZXN0IikseXQ9KGUsbix0KT0+UHJvbWlzZS5yZXNvbHZlKEV0KGUpKG4sdCkpLnRoZW4obz0+ZmUobyxyZSwiZGlnZXN0IikpO3ZhciBTbj1lPT5lIGluc3RhbmNlb2YgU2U/ZTpGKCJQb2ludCBleHBlY3RlZCIpLE10PWU9PkUoRShlKmUpKmUrYnQpLHd0PWU9PkJlKGUsMG4sdmUpLG5uPWU9PkJlKGUsMW4sdmUpLFhyPWU9PkJlKGUsMW4semUpLHNuPWU9PiEoZSYxbiksQnQ9ZT0+VWludDhBcnJheS5vZihlKSxZcj1lPT5CdChzbihlKT8yOjMpLE90PWU9PntsZXQgbj1NdChubihlKSksdD0xbjtmb3IobGV0IG89bixpPSh2ZSsxbikvNG47aT4wbjtpPj49MW4paSYxbiYmKHQ9dCpvJXZlKSxvPW8qbyV2ZTtyZXR1cm4gRSh0KnQpIT09biYmRigic3FydCBpbnZhbGlkIiksc24odCk/dDpFKC10KX07dmFyIFNlPWNsYXNzIGV7c3RhdGljIEJBU0U7c3RhdGljIFpFUk87WDtZO1o7Y29uc3RydWN0b3Iobix0LG8pe3RoaXMuWD13dChuKSx0aGlzLlk9bm4odCksdGhpcy5aPXd0KG8pLE9iamVjdC5mcmVlemUodGhpcyl9c3RhdGljIENVUlZFKCl7cmV0dXJuIFN0fXN0YXRpYyBmcm9tQWZmaW5lKG4pe2xldHt4OnQseTpvfT1uO3JldHVybiB0PT09MG4mJm89PT0wbj9NZTpuZXcgZSh0LG8sMW4pfXN0YXRpYyBmcm9tQnl0ZXMobil7ZmUobik7bGV0e3B1YmxpY0tleTp0LHB1YmxpY0tleVVuY29tcHJlc3NlZDpvfT1ibixpLHM9bi5sZW5ndGgscj1uWzBdLGE9bi5zdWJhcnJheSgxKSxjPXRuKGEsMCxyZSk7aWYocz09PXQmJihyPT09Mnx8cj09PTMpKXtsZXQgdT1PdChjKTtyPT09MyYmKHU9RSgtdSkpLGk9bmV3IGUoYyx1LDFuKX1yZXR1cm4gcz09PW8mJnI9PT00JiYoaT1uZXcgZShjLHRuKGEscmUsTmUpLDFuKSksaT9pLmFzc2VydFZhbGlkaXR5KCk6RigiYmFkIHBvaW50OiBub3Qgb24gY3VydmUiKX1zdGF0aWMgZnJvbUhleChuKXtyZXR1cm4gZS5mcm9tQnl0ZXMoQXQobikpfWdldCB4KCl7cmV0dXJuIHRoaXMudG9BZmZpbmUoKS54fWdldCB5KCl7cmV0dXJuIHRoaXMudG9BZmZpbmUoKS55fWVxdWFscyhuKXtsZXR7WDp0LFk6byxaOml9PXRoaXMse1g6cyxZOnIsWjphfT1TbihuKSxjPUUodCphKSx1PUUocyppKSxsPUUobyphKSxmPUUocippKTtyZXR1cm4gYz09PXUmJmw9PT1mfWlzMCgpe3JldHVybiB0aGlzLmVxdWFscyhNZSl9bmVnYXRlKCl7cmV0dXJuIG5ldyBlKHRoaXMuWCxFKC10aGlzLlkpLHRoaXMuWil9ZG91YmxlKCl7cmV0dXJuIHRoaXMuYWRkKHRoaXMpfWFkZChuKXtsZXR7WDp0LFk6byxaOml9PXRoaXMse1g6cyxZOnIsWjphfT1TbihuKSxjPTBuLHU9YnQsbD0wbixmPTBuLGQ9MG4sZz1FKHUqM24pLHA9RSh0KnMpLFI9RShvKnIpLGI9RShpKmEpLEI9RSh0K28pLHc9RShzK3IpO0I9RShCKncpLHc9RShwK1IpLEI9RShCLXcpLHc9RSh0K2kpO2xldCBDPUUocythKTtyZXR1cm4gdz1FKHcqQyksQz1FKHArYiksdz1FKHctQyksQz1FKG8raSksbD1FKHIrYSksQz1FKEMqbCksbD1FKFIrYiksQz1FKEMtbCksZD1FKGMqdyksbD1FKGcqYiksZD1FKGwrZCksbD1FKFItZCksZD1FKFIrZCksZj1FKGwqZCksUj1FKHArcCksUj1FKFIrcCksYj1FKGMqYiksdz1FKGcqdyksUj1FKFIrYiksYj1FKHAtYiksYj1FKGMqYiksdz1FKHcrYikscD1FKFIqdyksZj1FKGYrcCkscD1FKEMqdyksbD1FKEIqbCksbD1FKGwtcCkscD1FKEIqUiksZD1FKEMqZCksZD1FKGQrcCksbmV3IGUobCxmLGQpfXN1YnRyYWN0KG4pe3JldHVybiB0aGlzLmFkZChTbihuKS5uZWdhdGUoKSl9bXVsdGlwbHkobix0PSEwKXtpZighdCYmbj09PTBuKXJldHVybiBNZTtpZihYcihuKSxuPT09MW4pcmV0dXJuIHRoaXM7aWYodGhpcy5lcXVhbHMoT2UpKXJldHVybiB1byhuKS5wO2xldCBvPU1lLGk9T2U7Zm9yKGxldCBzPXRoaXM7bj4wbjtzPXMuZG91YmxlKCksbj4+PTFuKW4mMW4/bz1vLmFkZChzKTp0JiYoaT1pLmFkZChzKSk7cmV0dXJuIG99bXVsdGlwbHlVbnNhZmUobil7cmV0dXJuIHRoaXMubXVsdGlwbHkobiwhMSl9dG9BZmZpbmUoKXtsZXR7WDpuLFk6dCxaOm99PXRoaXM7aWYodGhpcy5lcXVhbHMoTWUpKXJldHVybnt4OjBuLHk6MG59O2lmKG89PT0xbilyZXR1cm57eDpuLHk6dH07bGV0IGk9WnIobyx2ZSk7cmV0dXJuIEUobyppKSE9PTFuJiZGKCJpbnZlcnNlIGludmFsaWQiKSx7eDpFKG4qaSkseTpFKHQqaSl9fWFzc2VydFZhbGlkaXR5KCl7bGV0e3g6bix5OnR9PXRoaXMudG9BZmZpbmUoKTtyZXR1cm4gbm4obiksbm4odCksRSh0KnQpPT09TXQobik/dGhpczpGKCJiYWQgcG9pbnQ6IG5vdCBvbiBjdXJ2ZSIpfXRvQnl0ZXMobj0hMCl7bGV0e3g6dCx5Om99PXRoaXMuYXNzZXJ0VmFsaWRpdHkoKS50b0FmZmluZSgpLGk9cGUodCk7cmV0dXJuIG4/VWUoWXIobyksaSk6VWUoQnQoNCksaSxwZShvKSl9dG9IZXgobil7cmV0dXJuIFJ0KHRoaXMudG9CeXRlcyhuKSl9fSxPZT1uZXcgU2UoSnIsVnIsMW4pLE1lPW5ldyBTZSgwbiwxbiwwbik7U2UuQkFTRT1PZTtTZS5aRVJPPU1lO3ZhciBRcj0oZSxuLHQpPT5PZS5tdWx0aXBseShuLCExKS5hZGQoZS5tdWx0aXBseSh0LCExKSkuYXNzZXJ0VmFsaWRpdHkoKSxDZT1lPT5UbigiMHgiKyhSdChlKXx8IjAiKSksdG49KGUsbix0KT0+Q2UoZS5zdWJhcnJheShuLHQpKSxlbz0ybioqMjU2bixwZT1lPT5BdChUdChCZShlLDBuLGVvKSxOZSkpLG5vPWU9PntsZXQgbj1DZShmZShlLHJlLCJzZWNyZXQga2V5IikpO3JldHVybiBCZShuLDFuLHplLCJpbnZhbGlkIHNlY3JldCBrZXk6IG91dHNpZGUgb2YgcmFuZ2UiKX07dmFyIFB0PSJTSEEtMjU2Iix0bz17aG1hY1NoYTI1NkFzeW5jOmFzeW5jKGUsbik9PntsZXQgdD1odCgpLG89IkhNQUMiLGk9YXdhaXQgdC5pbXBvcnRLZXkoInJhdyIsZSx7bmFtZTpvLGhhc2g6e25hbWU6UHR9fSwhMSxbInNpZ24iXSk7cmV0dXJuIEZlKGF3YWl0IHQuc2lnbihvLGksbikpfSxobWFjU2hhMjU2OnZvaWQgMCxzaGEyNTZBc3luYzphc3luYyBlPT5GZShhd2FpdCBodCgpLmRpZ2VzdChQdCxlKSksc2hhMjU2OnZvaWQgMH07dmFyIHJvPWU9PntpZihlPWU9PT12b2lkIDA/TW4oYm4uc2VlZCk6ZSxmZShlKSxlLmxlbmd0aDxibi5zZWVkfHxlLmxlbmd0aD4xMDI0KXJldHVybiBGKCJleHBlY3RlZCA0OC0xMDI0YiIsUmFuZ2VFcnJvcik7bGV0IG49RShDZShlKSx6ZS0xbik7cmV0dXJuIHBlKG4rMW4pfSxvbz1lPT5uPT57bGV0IHQ9cm8obik7cmV0dXJue3NlY3JldEtleTp0LHB1YmxpY0tleTplKHQpfX07dmFyIEN0PWU9PlVpbnQ4QXJyYXkuZnJvbSgiQklQMDM0MC8iK2Usbj0+bi5jaGFyQ29kZUF0KDApKSxEdD0iYXV4IixMdD0ibm9uY2UiLHh0PSJjaGFsbGVuZ2UiLFJuPShlLC4uLm4pPT57bGV0IHQ9cHQoInNoYTI1NiIsQ3QoZSkpO3JldHVybiBwdCgic2hhMjU2IixVZSh0LHQsLi4ubikpfSxBbj0oZSwuLi5uKT0+eXQoInNoYTI1NkFzeW5jIixDdChlKSkudGhlbih0PT55dCgic2hhMjU2QXN5bmMiLFVlKHQsdCwuLi5uKSkpLEJuPWU9PntsZXQgbj1ubyhlKSx0PU9lLm11bHRpcGx5KG4pLHt4Om8seTppfT10LmFzc2VydFZhbGlkaXR5KCkudG9BZmZpbmUoKSxzPXNuKGkpP246b24oLW4pLHI9cGUobyk7cmV0dXJue2Q6cyxweDpyfX0sT249ZT0+b24oQ2UoZSkpLEh0PSguLi5lKT0+T24oUm4oeHQsLi4uZSkpLF90PWFzeW5jKC4uLmUpPT5Pbihhd2FpdCBBbih4dCwuLi5lKSksSXQ9ZT0+Qm4oZSkucHgsc289b28oSXQpLE50PShlLG4sdCk9PntsZXR7cHg6byxkOml9PUJuKG4pO3JldHVybnttOmZlKGUpLHB4Om8sZDppLGE6ZmUodCxyZSl9fSxVdD1lPT57bGV0IG49T24oZSk7bj09PTBuJiZGKCJzaWduIGZhaWxlZDogayBpcyB6ZXJvIik7bGV0e3B4OnQsZDpvfT1CbihwZShuKSk7cmV0dXJue3J4OnQsazpvfX0sS3Q9KGUsbix0LG8pPT5VZShuLHBlKG9uKGUrdCpvKSkpLGp0PSJpbnZhbGlkIHNpZ25hdHVyZSBwcm9kdWNlZCIsYW89KGUsbix0PU1uKHJlKSk9PntsZXR7bTpvLHB4OmksZDpzLGE6cn09TnQoZSxuLHQpLGE9Um4oRHQsciksYz1wZShzXkNlKGEpKSx1PVJuKEx0LGMsaSxvKSx7cng6bCxrOmZ9PVV0KHUpLGQ9SHQobCxpLG8pLGc9S3QoZixsLGQscyk7cmV0dXJuICR0KGcsbyxpKXx8RihqdCksZ30saW89YXN5bmMoZSxuLHQ9TW4ocmUpKT0+e2xldHttOm8scHg6aSxkOnMsYTpyfT1OdChlLG4sdCksYT1hd2FpdCBBbihEdCxyKSxjPXBlKHNeQ2UoYSkpLHU9YXdhaXQgQW4oTHQsYyxpLG8pLHtyeDpsLGs6Zn09VXQodSksZD1hd2FpdCBfdChsLGksbyksZz1LdChmLGwsZCxzKTtyZXR1cm4gYXdhaXQgV3QoZyxvLGkpfHxGKGp0KSxnfSxjbz0oZSxuKT0+ZSBpbnN0YW5jZW9mIFByb21pc2U/ZS50aGVuKG4pOm4oZSkscXQ9KGUsbix0LG8pPT57bGV0IGk9ZmUoZSxOZSwic2lnbmF0dXJlIikscz1mZShuLHZvaWQgMCwibWVzc2FnZSIpLHI9ZmUodCxyZSwicHVibGljS2V5Iik7dHJ5e2xldCBhPUNlKHIpLGM9T3QoYSksdT1uZXcgU2UoYSxjLDFuKS5hc3NlcnRWYWxpZGl0eSgpLGw9cGUodS50b0FmZmluZSgpLngpLGY9dG4oaSwwLHJlKTtCZShmLDFuLHZlKTtsZXQgZD10bihpLHJlLE5lKTtCZShkLDFuLHplKTtsZXQgZz1VZShwZShmKSxsLHMpO3JldHVybiBjbyhvKGcpLHA9PntsZXR7eDpSLHk6Yn09UXIodSxkLG9uKC1wKSkudG9BZmZpbmUoKTtyZXR1cm4hKCFzbihiKXx8UiE9PWYpfSl9Y2F0Y2h7cmV0dXJuITF9fSwkdD0oZSxuLHQpPT5xdChlLG4sdCxIdCksV3Q9YXN5bmMoZSxuLHQpPT5xdChlLG4sdCxfdCksQ249T2JqZWN0LmZyZWV6ZSh7a2V5Z2VuOnNvLGdldFB1YmxpY0tleTpJdCxzaWduOmFvLHZlcmlmeTokdCxzaWduQXN5bmM6aW8sdmVyaWZ5QXN5bmM6V3R9KSxybj04LGZvPTI1NixGdD1NYXRoLmNlaWwoZm8vcm4pKzEsRW49MioqKHJuLTEpLGxvPSgpPT57bGV0IGU9W10sbj1PZSx0PW47Zm9yKGxldCBvPTA7bzxGdDtvKyspe3Q9bixlLnB1c2godCk7Zm9yKGxldCBpPTE7aTxFbjtpKyspdD10LmFkZChuKSxlLnB1c2godCk7bj10LmRvdWJsZSgpfXJldHVybiBlfSxrdCx2dD0oZSxuKT0+e2xldCB0PW4ubmVnYXRlKCk7cmV0dXJuIGU/dDpufSx1bz1lPT57bGV0IG49a3R8fChrdD1sbygpKSx0PU1lLG89T2UsaT0yKipybixzPWkscj1UbihpLTEpLGE9VG4ocm4pO2ZvcihsZXQgYz0wO2M8RnQ7YysrKXtsZXQgdT1OdW1iZXIoZSZyKTtlPj49YSx1PkVuJiYodS09cyxlKz0xbik7bGV0IGw9YypFbixmPWwsZD1sK01hdGguYWJzKHUpLTEsZz1jJTIhPT0wLHA9dTwwO3U9PT0wP289by5hZGQodnQoZyxuW2ZdKSk6dD10LmFkZCh2dChwLG5bZF0pKX1yZXR1cm4gZSE9PTBuJiZGKCJpbnZhbGlkIHduYWYiKSx7cDp0LGY6b319O3ZhcntmbG9vcjpMbixtaW46bW8sc2luOmdvfT1NYXRoLEc9IlRyeXN0ZXJvIixiZT0oZSxuKT0+QXJyYXkoZSkuZmlsbCh2b2lkIDApLm1hcChuKSxobz0iMDEyMzQ1Njc4OUFhQmJDY0RkRWVGZkdnSGhJaUpqS2tMbE1tTm5Pb1BwUXFSclNzVHRVdVZ2V3dYeFl5WnoiLGxlPWU9PmJlKGUsKCk9PmhvW0xuKE1hdGgucmFuZG9tKCkqNjIpXT8/IiIpLmpvaW4oIiIpLFk9bGUoMjApLGFlPVByb21pc2UuYWxsLmJpbmQoUHJvbWlzZSksSG49dHlwZW9mIHdpbmRvdzwidSIse2VudHJpZXM6bWUsZnJvbUVudHJpZXM6X24sa2V5czpRLHZhbHVlczp3ZX09T2JqZWN0LFY9KCk9Pnt9LGFuPSJjYW5kaWRhdGUiLF89ZT0+KGUhPT1udWxsJiZjbGVhclRpbWVvdXQoZSksbnVsbCksST1lPT5uZXcgRXJyb3IoYCR7R306ICR7ZX1gKSxQZT0oZSxuKT0+ZSBpbnN0YW5jZW9mIEVycm9yJiZlLm1lc3NhZ2U/ZS5tZXNzYWdlOnR5cGVvZiBlPT0ic3RyaW5nIiYmZT9lOlooZT8/biksdWU9KGUsbik9PmUgaW5zdGFuY2VvZiBFcnJvcj9lOkkoUGUoZSxuKSkscG89bmV3IFRleHRFbmNvZGVyLHlvPW5ldyBUZXh0RGVjb2RlcixkZT1lPT5wby5lbmNvZGUoZSksZ2U9ZT0+eW8uZGVjb2RlKGUpLGtlPWU9PmUucmVkdWNlKChuLHQpPT5uK3QudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIjAiKSwiIiksRGU9KC4uLmUpPT5lLmpvaW4oIkAiKSx3bz0oZSxuKT0+e2xldCB0PVsuLi5lXSxvPSgpPT57bGV0IHM9Z28obisrKSoxZTQ7cmV0dXJuIHMtTG4ocyl9LGk9dC5sZW5ndGg7Zm9yKDtpOyl7bGV0IHM9TG4obygpKmktLSkscj10W2ldO3RbaV09dFtzXSx0W3NdPXJ9cmV0dXJuIHR9LEluPShlLG4sdCxvPSExKT0+ZS5yZWxheUNvbmZpZz8udXJsc3x8KG8/d28obixjbihlLmFwcElkKSk6bikuc2xpY2UoMCxlLnJlbGF5Q29uZmlnPy5yZWR1bmRhbmN5Pz90KSxaPUpTT04uc3RyaW5naWZ5LGhlPWU9Pnt0cnl7cmV0dXJuIEpTT04ucGFyc2UoZSl9Y2F0Y2h7dGhyb3cgSShgZmFpbGVkIHRvIHBhcnNlIEpTT046ICR7ZX1gKX19LGNuPShlLG49TnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpPT5lLnNwbGl0KCIiKS5yZWR1Y2UoKHQsbyk9PnQrby5jaGFyQ29kZUF0KDApLDApJW4senQ9MzMzMyxKdD02ZTQsRG49e30sSmU9bnVsbCx4bj1udWxsLE5uPSgpPT57SmV8fChKZT1uZXcgUHJvbWlzZShlPT57eG49ZX0pLmZpbmFsbHkoKCk9Pnt4bj1udWxsLEplPW51bGx9KSl9LFVuPSgpPT57eG4/LigpfSxLbj0oZSxuLHQpPT57bGV0IG89e30saT0hMSxzPSExLHIsYT1WO28uaXNDbG9zZWQ9ITEsby5yZWFkeT1uZXcgUHJvbWlzZSh1PT5hPXUpO2xldCBjPSgpPT57aWYoby5pc0Nsb3NlZClyZXR1cm47cj12b2lkIDAscz0hMTtsZXQgdT1uZXcgV2ViU29ja2V0KGUpO3Uub25jbG9zZT0oKT0+e2lmKG8uaXNDbG9zZWR8fHMpcmV0dXJuO2lmKHM9ITAsSmUpe0plLnRoZW4oYyk7cmV0dXJufWxldCBsPURuW2VdPz89enQ7aWYobD49SnQpe28uaXNDbG9zZWQ9ITA7cmV0dXJufXI9c2V0VGltZW91dChjLE1hdGgucmFuZG9tKCkqbCksRG5bZV09bW8obCoyLEp0KX0sdS5vbm1lc3NhZ2U9bD0+bihTdHJpbmcobC5kYXRhKSksby5zb2NrZXQ9dSxvLnVybD11LnVybCx1Lm9ub3Blbj0oKT0+e2xldCBsPWk7aT0hMCxhKG8pLERuW2VdPXp0LGwmJnQ/LigpfSxvLnNlbmQ9bD0+e3UucmVhZHlTdGF0ZT09PTEmJnUuc2VuZChsKX19O3JldHVybiBvLmNsb3NlPSgpPT57by5pc0Nsb3NlZD0hMCxyIT09dm9pZCAwJiYoY2xlYXJUaW1lb3V0KHIpLHI9dm9pZCAwKSxvLnNvY2tldC5jbG9zZSgpfSxjKCksb307dmFyIGpuPWU9PntsZXQgbj17fSx0PW5ldyBXZWFrTWFwLG89cj0+e2xldCBhPXQuZ2V0KHIpO2lmKCFhKXRocm93IEkoInJlbGF5IGJvb2trZWVwaW5nIG1pc3NpbmcgcmVnaXN0cmF0aW9uIGZvciByZWxheSBjbGllbnQiKTtyZXR1cm4gYX0saT0oKT0+e2xldCByPXt9LGE9Yz0+cltjXT8/PXt9O3JldHVybntmb3JLZXk6YSxmb3JSZWxheTpjPT5hKG8oYykpfX0scz0ocixhKT0+KG5bcl09YSx0LnNldChhLHIpLGEpO3JldHVybntyZWdpc3RlcjoocixhKT0+e2xldCBjPW5bcl07cmV0dXJuIGN8fHMocixhKCkpfSxrZXlPZjpvLHNjb3BlZDppLGdldFNvY2tldHM6KCk9Pl9uKG1lKG4pLmZsYXRNYXAoKFtyLGFdKT0+e2xldCBjPWUoYSk7cmV0dXJuIGM/W1tyLGNdXTpbXX0pKX19LFZ0PSgpPT57aWYoSG4pe2xldCBlPW5ldyBBYm9ydENvbnRyb2xsZXI7cmV0dXJuIGFkZEV2ZW50TGlzdGVuZXIoIm9ubGluZSIsVW4se3NpZ25hbDplLnNpZ25hbH0pLGFkZEV2ZW50TGlzdGVuZXIoIm9mZmxpbmUiLE5uLHtzaWduYWw6ZS5zaWduYWx9KSwoKT0+ZS5hYm9ydCgpfXJldHVybiBWfTt2YXIgcW49IkFFUy1HQ00iLFBvPXt9LGtvPWU9PmJ0b2EoU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLEFycmF5LmZyb20obmV3IFVpbnQ4QXJyYXkoZSkpKSksdm89ZT0+e2xldCBuPWF0b2IoZSk7cmV0dXJuIG5ldyBVaW50OEFycmF5KG4ubGVuZ3RoKS5tYXAoKHQsbyk9Pm4uY2hhckNvZGVBdChvKSkuYnVmZmVyfSxMZT1hc3luYyhlLG4pPT5uZXcgVWludDhBcnJheShhd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdChlLGRlKG4pKSksVGU9YXN5bmMgZT0+UG9bZV0/Pz1BcnJheS5mcm9tKGF3YWl0IExlKCJTSEEtMSIsZSkpLm1hcChuPT5uLnRvU3RyaW5nKDM2KSkuam9pbigiIiksR3Q9YXN5bmMoZSxuLHQpPT5jcnlwdG8uc3VidGxlLmltcG9ydEtleSgicmF3Iixhd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCh7bmFtZToiU0hBLTI1NiJ9LGRlKGAke2V9OiR7bn06JHt0fWApKSx7bmFtZTpxbn0sITEsWyJlbmNyeXB0IiwiZGVjcnlwdCJdKSxadD1hc3luYyhlLG4pPT5rZShhd2FpdCBMZSgiU0hBLTI1NiIsYCR7R306JHtlfToke259YCkpLFh0PSIkIixZdD0iLCIsUXQ9YXN5bmMoZSxuKT0+e2xldCB0PWNyeXB0by5nZXRSYW5kb21WYWx1ZXMobmV3IFVpbnQ4QXJyYXkoMTYpKTtyZXR1cm4gdC5qb2luKFl0KStYdCtrbyhhd2FpdCBjcnlwdG8uc3VidGxlLmVuY3J5cHQoe25hbWU6cW4saXY6dH0sYXdhaXQgZSxkZShuKSkpfSxlcj1hc3luYyhlLG4pPT57bGV0W3Qsb109bi5zcGxpdChYdCk7cmV0dXJuIGdlKGF3YWl0IGNyeXB0by5zdWJ0bGUuZGVjcnlwdCh7bmFtZTpxbixpdjpuZXcgVWludDhBcnJheSh0Py5zcGxpdChZdCkubWFwKE51bWJlcik/P1tdKX0sYXdhaXQgZSx2byhvPz8iIikpKX07dmFyIFZlPTU3MzMzLFNvPTE4ZTQsYm89OCxucj1jbGFzc3ttYWtlT2ZmZXI7cG9vbD1bXTtwb29sZWQ9bmV3IFNldDtsZWFzZWQ9bmV3IE1hcDtyZWN5Y2xpbmc9bmV3IFNldDtjbGVhbnVwVGltZXI9bnVsbDthY3RpdmU9ITE7Y29uc3RydWN0b3IoZSl7dGhpcy5tYWtlT2ZmZXI9ZX1nZXQgaXNBY3RpdmUoKXtyZXR1cm4gdGhpcy5hY3RpdmV9d2FybXVwKCl7dGhpcy5wb29sPVtdLHRoaXMucG9vbGVkLmNsZWFyKCksYmUoYm8sdGhpcy5tYWtlT2ZmZXIpLmZvckVhY2goZT0+dGhpcy5wdXNoKGUpKSx0aGlzLmFjdGl2ZT0hMCx0aGlzLmNsZWFudXBUaW1lcj1zZXRJbnRlcnZhbCgoKT0+e3RoaXMucG9vbD10aGlzLnBvb2wuZmlsdGVyKGU9PmUuaXNEZWFkPyh0aGlzLnBvb2xlZC5kZWxldGUoZSksITEpOiEwKX0sVmUpfXB1c2goZSl7ZS5pc0RlYWR8fHRoaXMucG9vbGVkLmhhcyhlKXx8dGhpcy5sZWFzZWQuaGFzKGUpfHwodGhpcy5wb29sLnB1c2goZSksdGhpcy5wb29sZWQuYWRkKGUpKX1zaGlmdChlKXtsZXQgbj1bXTtmb3IoO24ubGVuZ3RoPGUmJnRoaXMucG9vbC5sZW5ndGg+MDspe2xldCB0PXRoaXMucG9vbC5zaGlmdCgpO2lmKCF0KWJyZWFrO3RoaXMucG9vbGVkLmRlbGV0ZSh0KSxuLnB1c2godCl9cmV0dXJuIG59Y2xhaW1MZWFzZWQoZSl7bGV0IG49dGhpcy5sZWFzZWQuZ2V0KGUpO24mJihfKG4pLHRoaXMubGVhc2VkLmRlbGV0ZShlKSl9cmVjeWNsZShlKXtpZighKGUuaXNEZWFkfHx0aGlzLnJlY3ljbGluZy5oYXMoZSkpKXtpZihlLmNvbm5lY3Rpb24ucmVtb3RlRGVzY3JpcHRpb24pe2UuZGVzdHJveSgpO3JldHVybn1pZighdGhpcy5hY3RpdmUpe2UuZGVzdHJveSgpO3JldHVybn10aGlzLnJlY3ljbGluZy5hZGQoZSksZS5zZXRIYW5kbGVycyh7Y29ubmVjdDpWLGNsb3NlOlYsZXJyb3I6Vn0pLGUuZ2V0T2ZmZXIoITApLnRoZW4obj0+e2lmKCFufHxuLnR5cGUhPT0ib2ZmZXIifHxlLmlzRGVhZHx8IXRoaXMuYWN0aXZlKXtlLmRlc3Ryb3koKTtyZXR1cm59dGhpcy5wdXNoKGUpfSkuY2F0Y2goKCk9PmUuZGVzdHJveSgpKS5maW5hbGx5KCgpPT50aGlzLnJlY3ljbGluZy5kZWxldGUoZSkpfX1yZWNsYWltTGVhc2VkKGUpe2xldCBuPXRoaXMubGVhc2VkLmdldChlKTtuJiYoXyhuKSx0aGlzLmxlYXNlZC5kZWxldGUoZSksdGhpcy5yZWN5Y2xlKGUpKX1sZWFzZShlKXt0aGlzLmNsYWltTGVhc2VkKGUpLHRoaXMubGVhc2VkLnNldChlLHNldFRpbWVvdXQoKCk9Pnt0aGlzLmxlYXNlZC5kZWxldGUoZSksdGhpcy5yZWN5Y2xlKGUpfSxTbykpfWNoZWNrb3V0KGUsbix0KXtsZXQgbz10aGlzLnNoaWZ0KGUpLGk9TWF0aC5tYXgoMCxlLW8ubGVuZ3RoKTtpPjAmJm8ucHVzaCguLi5iZShpLHRoaXMubWFrZU9mZmVyKSk7bGV0IHM9YXN5bmMocixhPSExKT0+e3RyeXtsZXQgYz1hd2FpdCB0KHIpO3JldHVybiBuPyh0aGlzLmxlYXNlKHIpLHtwZWVyOnIsb2ZmZXI6YyxjbGFpbTooKT0+dGhpcy5jbGFpbUxlYXNlZChyKSxyZWNsYWltOigpPT50aGlzLnJlY2xhaW1MZWFzZWQocil9KTp7cGVlcjpyLG9mZmVyOmN9fWNhdGNoKGMpe2lmKHRoaXMuY2xhaW1MZWFzZWQociksdGhpcy5wb29sZWQuZGVsZXRlKHIpLHIuZGVzdHJveSgpLCFhKXJldHVybiBzKHRoaXMubWFrZU9mZmVyKCksITApO3Rocm93IGN9fTtyZXR1cm4gYWUoby5tYXAocj0+cyhyKSkpfWdldE9mZmVycyhlLG4pe3JldHVybiB0aGlzLmNoZWNrb3V0KGUsITAsbil9ZGVzdHJveSgpe3RoaXMuYWN0aXZlPSExLHRoaXMuY2xlYW51cFRpbWVyJiYoY2xlYXJJbnRlcnZhbCh0aGlzLmNsZWFudXBUaW1lciksdGhpcy5jbGVhbnVwVGltZXI9bnVsbCksdGhpcy5wb29sLmZvckVhY2goZT0+ZS5kZXN0cm95KCkpLHRoaXMucG9vbD1bXSx0aGlzLnBvb2xlZC5jbGVhcigpLHRoaXMubGVhc2VkLmZvckVhY2goKGUsbik9PntfKGUpLG4uZGVzdHJveSgpfSksdGhpcy5sZWFzZWQuY2xlYXIoKSx0aGlzLnJlY3ljbGluZy5mb3JFYWNoKGU9PmUuZGVzdHJveSgpKSx0aGlzLnJlY3ljbGluZy5jbGVhcigpfX07dmFyICRuPUkoImluY29ycmVjdCBwYXNzd29yZCBmb3Igb3ZlcmxhcHBpbmcgcm9vbSIpLHRyPShlLG4sdCk9PntsZXQgbz1yPT5MZSgiU0hBLTI1NiIsYCR7cn06JHtlfToke259OiR7dH1gKS50aGVuKGtlKSxpPWFzeW5jKHIsYSxjKT0+e2lmKCFlKXJldHVybjtpZihjKXtsZXQgbD1sZSgzNik7YXdhaXQgcih7X190cnlzdGVyb19wdzoiY2hhbGxlbmdlIixjOmx9KTtsZXR7ZGF0YTpmfT1hd2FpdCBhKCk7aWYoIWZ8fHR5cGVvZiBmIT0ib2JqZWN0Inx8Zi5fX3RyeXN0ZXJvX3B3IT09InJlc3BvbnNlInx8dHlwZW9mIGYuaCE9InN0cmluZyIpdGhyb3cgJG47bGV0IGQ9YXdhaXQgbyhsKTtpZihmLmghPT1kKXRocm93ICRuO3JldHVybn1sZXR7ZGF0YTp1fT1hd2FpdCBhKCk7aWYoIXV8fHR5cGVvZiB1IT0ib2JqZWN0Inx8dS5fX3RyeXN0ZXJvX3B3IT09ImNoYWxsZW5nZSJ8fHR5cGVvZiB1LmMhPSJzdHJpbmciKXRocm93ICRuO2F3YWl0IHIoe19fdHJ5c3Rlcm9fcHc6InJlc3BvbnNlIixoOmF3YWl0IG8odS5jKX0pfTtyZXR1cm57cnVuOmksY29tcG9zZTpyPT5lfHxyP2FzeW5jKGEsYyx1LGwpPT57YXdhaXQgaShjLHUsbCksYXdhaXQgcj8uKGEsYyx1LGwpfTp2b2lkIDB9fSxUbz1lPT57bGV0IG49UGUoZSwidW5rbm93biBlcnJvciIpO3JldHVybiBuLnN0YXJ0c1dpdGgoImhhbmRzaGFrZSAiKT9uOmBoYW5kc2hha2UgZmFpbGVkOiAke259YH0scnI9KHtvblBlZXJIYW5kc2hha2U6ZSxvbkhhbmRzaGFrZUVycm9yOm4saGFuZHNoYWtlVGltZW91dE1zOnQsc2VuZEhhbmRzaGFrZURhdGE6byxzZW5kSGFuZHNoYWtlUmVhZHk6aSxvbkFjdGl2YXRlOnMsb25GYWlsdXJlOnJ9KT0+e2xldCBhPXt9LGM9KGYsZCk9PntsZXQgZz1hW2ZdOyFnfHxkJiZnLnBlZXIhPT1kfHxnLmlzQWN0aXZlfHwhZy5kaWRMb2NhbEhhbmRzaGFrZVBhc3N8fCFnLmRpZFJlY2VpdmVSZW1vdGVSZWFkeXx8KGcuaXNBY3RpdmU9ITAsZy5oYW5kc2hha2VUaW1lcj1fKGcuaGFuZHNoYWtlVGltZXIpLHMoZixnLnBlZXIpKX0sdT0oZixkLGcpPT57bGV0IHA9YVtmXTtpZighcHx8cC5wZWVyIT09ZClyZXR1cm47bGV0IFI9VG8oZyk7bj8uKGYsUikscihmLGQsSShSKSl9LGw9KGYsZCk9PntsZXQgZz1hW2ZdOyFnfHxnLnBlZXIhPT1kfHxnLmlzQWN0aXZlfHwoZy5kaWRMb2NhbEhhbmRzaGFrZVBhc3M9ITAsaSgiIixmKS5jYXRjaChwPT51KGYsZCxJKGBmYWlsZWQgc2VuZGluZyBoYW5kc2hha2UgcmVhZGluZXNzOiAke1BlKHAsInVua25vd24gc2VuZCBmYWlsdXJlIil9YCkpKSxjKGYsZCkpfTtyZXR1cm57YWRkUGVlcjooZixkKT0+e2FbZl09e3BlZXI6ZCxpc0FjdGl2ZTohMSxkaWRMb2NhbEhhbmRzaGFrZVBhc3M6ITEsZGlkUmVjZWl2ZVJlbW90ZVJlYWR5OiExLGhhbmRzaGFrZVRpbWVyOm51bGwscGVuZGluZ0hhbmRzaGFrZVBheWxvYWRzOltdLGhhbmRzaGFrZVdhaXRlcnM6W119fSxjbGVhclBlZXI6KGYsZCk9PntsZXQgZz1hW2ZdO2cmJihnLmhhbmRzaGFrZVRpbWVyPV8oZy5oYW5kc2hha2VUaW1lciksZy5wZW5kaW5nSGFuZHNoYWtlUGF5bG9hZHMubGVuZ3RoPTAsZy5oYW5kc2hha2VXYWl0ZXJzLnNwbGljZSgwKS5mb3JFYWNoKHA9PnAucmVqZWN0KGQpKSxkZWxldGUgYVtmXSl9LGNhblJlY2VpdmVGcm9tUGVlcjooZixkKT0+e2xldCBnPWFbZl07cmV0dXJuISEoZyYmKGcuaXNBY3RpdmV8fGQpKX0sc3RhcnQ6KGYsZCk9PntsZXQgZz1hW2ZdO2lmKCFnfHxnLnBlZXIhPT1kKXJldHVybjtnLmhhbmRzaGFrZVRpbWVyPXNldFRpbWVvdXQoKCk9PnUoZixkLEkoYGhhbmRzaGFrZSB0aW1lZCBvdXQgYWZ0ZXIgJHt0fW1zYCkpLHQpO2xldCBwPWFzeW5jKEIsdyk9Pnthd2FpdCBvKEIsZix3KX0sUj0oKT0+bmV3IFByb21pc2UoKEIsdyk9PntsZXQgQz1hW2ZdO2lmKCFDfHxDLnBlZXIhPT1kKXt3KEkoInBlZXIgZGlzY29ubmVjdGVkIGR1cmluZyBoYW5kc2hha2UiKSk7cmV0dXJufWxldCBIPUMucGVuZGluZ0hhbmRzaGFrZVBheWxvYWRzLnNoaWZ0KCk7aWYoSCl7QihIKTtyZXR1cm59Qy5oYW5kc2hha2VXYWl0ZXJzLnB1c2goe3Jlc29sdmU6QixyZWplY3Q6dj0+dyh2KX0pfSksYj1ZPGY7UHJvbWlzZS5yZXNvbHZlKGU/LihmLHAsUixiKSkudGhlbigoKT0+bChmLGQpKS5jYXRjaChCPT51KGYsZCx1ZShCLCJoYW5kc2hha2UgZmFpbGVkIikpKX0scmVjZWl2ZUhhbmRzaGFrZURhdGE6KGYsZCxnKT0+e2xldCBwPWFbZF07aWYoIXB8fHAuaXNBY3RpdmUpcmV0dXJuO2xldCBSPWc9PT12b2lkIDA/e2RhdGE6Zn06e2RhdGE6ZixtZXRhZGF0YTpnfSxiPXAuaGFuZHNoYWtlV2FpdGVycy5zaGlmdCgpO2lmKGIpe2IucmVzb2x2ZShSKTtyZXR1cm59cC5wZW5kaW5nSGFuZHNoYWtlUGF5bG9hZHMucHVzaChSKX0scmVjZWl2ZUhhbmRzaGFrZVJlYWR5OmY9PntsZXQgZD1hW2ZdOyFkfHxkLmlzQWN0aXZlfHwoZC5kaWRSZWNlaXZlUmVtb3RlUmVhZHk9ITAsYyhmKSl9fX07dmFyIFJvPTE1ZTMsQW89NWUzLG9yPSJpY2VnYXRoZXJpbmdzdGF0ZWNoYW5nZSIsRW89ImljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZSIsR2U9Im9mZmVyIixNbz0iYW5zd2VyIixCbz0vb3V0IG9mIHJhbmdlL2ksc3I9ZT0+ZS5yZXBsYWNlKC8gKFxTK1wubG9jYWwpIChcZCspIHR5cCBob3N0L2csIiAxMjcuMC4wLjEgJDIgdHlwIGhvc3QiKSxXbj0oZSx7dHJpY2tsZUljZTpuLHJ0Y0NvbmZpZzp0LHJ0Y1BvbHlmaWxsOm8sdHVybkNvbmZpZzppLF90ZXN0X29ubHlfbWRuc0hvc3RGYWxsYmFja1RvTG9vcGJhY2s6c30pPT57bGV0IHI9bmV3KG8/P1JUQ1BlZXJDb25uZWN0aW9uKSh7aWNlU2VydmVyczpPby5jb25jYXQoaT8/W10pLC4uLnR9KSxhPXt9LGM9W10sdT1bXSxsPW4hPT0hMSxmPVtdLGQ9W10sZz0hMSxwPSExLFI9bnVsbCxiPW51bGwsQj0hMSx3PSgpPT5iPV8oYiksQz0oKT0+e0J8fChCPSEwLHcoKSxhLmNsb3NlPy4oKSl9LEg9aD0+e2Euc2lnbmFsP2Euc2lnbmFsKGgpOmMucHVzaChoKX0sdj1oPT57bGV0IGs9YS5zaWduYWw7YS5zaWduYWw9eD0+e2s/Lih4KSxoKHgpfSxjLmxlbmd0aD4wJiZjLnNwbGljZSgwKS5mb3JFYWNoKHg9PmEuc2lnbmFsPy4oeCkpfSxBPWg9PnM/c3IoaCk6aCxLPWg9PntpZighc3x8dHlwZW9mIGguY2FuZGlkYXRlIT0ic3RyaW5nIilyZXR1cm4gaDtsZXQgaz1zcihoLmNhbmRpZGF0ZSk7cmV0dXJuIGs9PT1oLmNhbmRpZGF0ZT9oOnsuLi5oLGNhbmRpZGF0ZTprfX0sVD1oPT4oe3R5cGU6aC5sb2NhbERlc2NyaXB0aW9uPy50eXBlPz9HZSxzZHA6QShoLmxvY2FsRGVzY3JpcHRpb24/LnNkcD8/IiIpfSksJD0oKT0+e2xldCBoPXIucmVtb3RlRGVzY3JpcHRpb24/LnNkcDtyZXR1cm4gaD9oLm1hdGNoKC9hPWljZS11ZnJhZzooW15cc10rKS8pPy5bMV0/P251bGw6bnVsbH0sej0oKT0+KHIucmVtb3RlRGVzY3JpcHRpb24/LnNkcD8ubWF0Y2goL15tPS9nbSk/P1tdKS5sZW5ndGgsaj1oPT57aWYoIXIucmVtb3RlRGVzY3JpcHRpb24pcmV0dXJuITE7bGV0IGs9eigpO2lmKHR5cGVvZiBoLnNkcE1MaW5lSW5kZXg9PSJudW1iZXIiJiZrPjAmJmguc2RwTUxpbmVJbmRleD49aylyZXR1cm4hMTtsZXQgeD0kKCk7cmV0dXJuISh4JiZoLnVzZXJuYW1lRnJhZ21lbnQmJmgudXNlcm5hbWVGcmFnbWVudCE9PXgpfSxXPWFzeW5jIGg9Pnt0cnl7cmV0dXJuIGF3YWl0IHIuYWRkSWNlQ2FuZGlkYXRlKGgpLCEwfWNhdGNoKGspe2lmKGsgaW5zdGFuY2VvZiBFcnJvciYmQm8udGVzdChrLm1lc3NhZ2UpJiZ0eXBlb2YgaC5zZHBNTGluZUluZGV4PT0ibnVtYmVyIilyZXR1cm4hMTt0aHJvdyBrfX0sZWU9YXN5bmMoKT0+e2lmKCFyLnJlbW90ZURlc2NyaXB0aW9ufHxmLmxlbmd0aD09PTApcmV0dXJuO2xldCBoPWYuc3BsaWNlKDApLGs9W107Zm9yKGxldCB4IG9mIGgpe2lmKCFqKHgpKXtrLnB1c2goeCk7Y29udGludWV9YXdhaXQgVyh4KXx8ay5wdXNoKHgpfWsubGVuZ3RoPjAmJmYucHVzaCguLi5rKX0sbT1hc3luYyBoPT57aWYoaihoKSl7YXdhaXQgVyhoKXx8Zi5wdXNoKGgpO3JldHVybn1mLnB1c2goaCl9LHk9aD0+e2guYmluYXJ5VHlwZT0iYXJyYXlidWZmZXIiLGguYnVmZmVyZWRBbW91bnRMb3dUaHJlc2hvbGQ9NjU1MzUsaC5vbm1lc3NhZ2U9az0+e2xldCB4PWsuZGF0YTthLmRhdGE/YS5kYXRhKHgpOnUucHVzaCh4KX0saC5vbm9wZW49KCk9PmEuY29ubmVjdD8uKCksaC5vbmNsb3NlPUMsaC5vbmVycm9yPSh7ZXJyb3I6a30pPT5hLmVycm9yPy4odWUoaywiZGF0YSBjaGFubmVsIGVycm9yIikpfSxTPWFzeW5jIGg9PntsZXQgaz1udWxsO3RyeXthd2FpdCBQcm9taXNlLnJhY2UoW25ldyBQcm9taXNlKHg9PntsZXQgbmU9KCk9PntoLmljZUdhdGhlcmluZ1N0YXRlPT09ImNvbXBsZXRlIiYmKGgucmVtb3ZlRXZlbnRMaXN0ZW5lcihvcixuZSkseCgpKX07aC5hZGRFdmVudExpc3RlbmVyKG9yLG5lKSxuZSgpfSksbmV3IFByb21pc2UoeD0+e2s9c2V0VGltZW91dCh4LFJvKX0pXSl9ZmluYWxseXtfKGspfXJldHVybiBUKGgpfSxQPWFzeW5jKCk9PntsZXQgaD1sP1Qocik6YXdhaXQgUyhyKTtyZXR1cm4gSChoKSxofTtlPyhSPXIuY3JlYXRlRGF0YUNoYW5uZWwoImRhdGEiKSx5KFIpKTpyLm9uZGF0YWNoYW5uZWw9KHtjaGFubmVsOmh9KT0+e1I9aCx5KGgpfTtsZXQgTT1hc3luYyhoPSExKT0+e2lmKHIuY29ubmVjdGlvblN0YXRlIT09ImNsb3NlZCIpdHJ5e3JldHVybiBnPSEwLGgmJihyLnNpZ25hbGluZ1N0YXRlIT09InN0YWJsZSImJnIuc2lnbmFsaW5nU3RhdGUhPT0iY2xvc2VkIiYmci5sb2NhbERlc2NyaXB0aW9uPy50eXBlPT09R2UmJmF3YWl0IHIuc2V0TG9jYWxEZXNjcmlwdGlvbih7dHlwZToicm9sbGJhY2sifSksdHlwZW9mIHIucmVzdGFydEljZT09ImZ1bmN0aW9uIiYmci5yZXN0YXJ0SWNlKCkpLGF3YWl0IHIuc2V0TG9jYWxEZXNjcmlwdGlvbihoP2F3YWl0IHIuY3JlYXRlT2ZmZXIoe2ljZVJlc3RhcnQ6ITB9KTp2b2lkIDApLGF3YWl0IFAoKX1jYXRjaChrKXthLmVycm9yPy4odWUoaywiZmFpbGVkIHRvIGNyZWF0ZSBsb2NhbCBvZmZlciIpKX1maW5hbGx5e2c9ITF9fTtyLm9ubmVnb3RpYXRpb25uZWVkZWQ9YXN5bmMoKT0+TSghMSksci5vbmljZWNhbmRpZGF0ZT0oe2NhbmRpZGF0ZTpofSk9PntpZighbHx8IWgpcmV0dXJuO2xldCBrPUsodHlwZW9mIGgudG9KU09OPT0iZnVuY3Rpb24iP2gudG9KU09OKCk6e2NhbmRpZGF0ZTpoLmNhbmRpZGF0ZSxzZHBNaWQ6aC5zZHBNaWQsc2RwTUxpbmVJbmRleDpoLnNkcE1MaW5lSW5kZXgsdXNlcm5hbWVGcmFnbWVudDpoLnVzZXJuYW1lRnJhZ21lbnR9KTtIKHt0eXBlOmFuLHNkcDpKU09OLnN0cmluZ2lmeShrKX0pfTtsZXQgTj0oKT0+e2lmKHIuY29ubmVjdGlvblN0YXRlPT09ImZhaWxlZCJ8fHIuY29ubmVjdGlvblN0YXRlPT09ImNsb3NlZCJ8fHIuaWNlQ29ubmVjdGlvblN0YXRlPT09ImZhaWxlZCJ8fHIuaWNlQ29ubmVjdGlvblN0YXRlPT09ImNsb3NlZCIpe0MoKTtyZXR1cm59aWYoci5jb25uZWN0aW9uU3RhdGU9PT0iY29ubmVjdGVkInx8ci5jb25uZWN0aW9uU3RhdGU9PT0iY29ubmVjdGluZyJ8fHIuaWNlQ29ubmVjdGlvblN0YXRlPT09ImNvbm5lY3RlZCJ8fHIuaWNlQ29ubmVjdGlvblN0YXRlPT09ImNvbXBsZXRlZCJ8fHIuaWNlQ29ubmVjdGlvblN0YXRlPT09ImNoZWNraW5nIil7dygpO3JldHVybn1pZihyLmNvbm5lY3Rpb25TdGF0ZT09PSJkaXNjb25uZWN0ZWQifHxyLmljZUNvbm5lY3Rpb25TdGF0ZT09PSJkaXNjb25uZWN0ZWQiKXtifHwoYj1zZXRUaW1lb3V0KCgpPT57Yj1udWxsLChyLmNvbm5lY3Rpb25TdGF0ZT09PSJkaXNjb25uZWN0ZWQifHxyLmljZUNvbm5lY3Rpb25TdGF0ZT09PSJkaXNjb25uZWN0ZWQiKSYmQygpfSxBbykpO3JldHVybn19O3Iub25jb25uZWN0aW9uc3RhdGVjaGFuZ2U9TixyLmFkZEV2ZW50TGlzdGVuZXIoRW8sTiksci5vbnRyYWNrPWg9PntsZXQgaz1oLnN0cmVhbXNbMF07aWYoayl7aWYoIWEudHJhY2smJiFhLnN0cmVhbSl7ZC5wdXNoKHt0cmFjazpoLnRyYWNrLHN0cmVhbTprfSk7cmV0dXJufWEudHJhY2s/LihoLnRyYWNrLGspLGEuc3RyZWFtPy4oayl9fSxyLm9ucmVtb3Zlc3RyZWFtPWg9PmEuc3RyZWFtPy4oaC5zdHJlYW0pO2xldCBxPWU/bmV3IFByb21pc2UoaD0+dihrPT57ay50eXBlPT09R2UmJmgoayl9KSk6UHJvbWlzZS5yZXNvbHZlKCk7cmV0dXJuIGUmJnF1ZXVlTWljcm90YXNrKCgpPT57IWcmJnIuc2lnbmFsaW5nU3RhdGU9PT0ic3RhYmxlIiYmIXIubG9jYWxEZXNjcmlwdGlvbiYmci5jb25uZWN0aW9uU3RhdGUhPT0iY2xvc2VkIiYmci5vbm5lZ290aWF0aW9ubmVlZGVkPy4obmV3IEV2ZW50KCJuZWdvdGlhdGlvbm5lZWRlZCIpKX0pLHtjcmVhdGVkOkRhdGUubm93KCksY29ubmVjdGlvbjpyLGdldCBjaGFubmVsKCl7cmV0dXJuIFJ9LGdldCBpc0RlYWQoKXtyZXR1cm4gci5jb25uZWN0aW9uU3RhdGU9PT0iY2xvc2VkIn0sZ2V0T2ZmZXI6YXN5bmMoaD0hMSk9PntpZihlKXJldHVybiBoP00oITApOnIubG9jYWxEZXNjcmlwdGlvbj8udHlwZT09PUdlP2w/VChyKTpTKHIpOnF9LGFzeW5jIHNpZ25hbChoKXtpZihoLnR5cGU9PT0iY2FuZGlkYXRlIil7dHJ5e2xldCBrPUpTT04ucGFyc2UoaC5zZHApO2smJnR5cGVvZiBrPT0ib2JqZWN0IiYmYXdhaXQgbShLKGspKX1jYXRjaChrKXthLmVycm9yPy4odWUoaywiZmFpbGVkIHRvIHBhcnNlIHJlbW90ZSBjYW5kaWRhdGUiKSl9cmV0dXJufWlmKCEoUj8ucmVhZHlTdGF0ZT09PSJvcGVuIiYmIWguc2RwPy5pbmNsdWRlcygiYT1ydHBtYXAiKSkpdHJ5e2xldCBrPXsuLi5oLHNkcDpBKGguc2RwKX07aWYoaC50eXBlPT09R2Upe2lmKGd8fHIuc2lnbmFsaW5nU3RhdGUhPT0ic3RhYmxlIiYmIXApe2lmKGUpcmV0dXJuO2F3YWl0IGFlKFtyLnNldExvY2FsRGVzY3JpcHRpb24oe3R5cGU6InJvbGxiYWNrIn0pLHIuc2V0UmVtb3RlRGVzY3JpcHRpb24oayldKX1lbHNlIGF3YWl0IHIuc2V0UmVtb3RlRGVzY3JpcHRpb24oayk7cmV0dXJuIGF3YWl0IGVlKCksYXdhaXQgci5zZXRMb2NhbERlc2NyaXB0aW9uKCksYXdhaXQgUCgpfWlmKGgudHlwZT09PU1vKXtwPSEwO3RyeXthd2FpdCByLnNldFJlbW90ZURlc2NyaXB0aW9uKGspLGF3YWl0IGVlKCl9ZmluYWxseXtwPSExfX19Y2F0Y2goayl7YS5lcnJvcj8uKHVlKGssImZhaWxlZCB0byBhcHBseSByZW1vdGUgc2lnbmFsIikpfX0sc2VuZERhdGE6aD0+Uj8uc2VuZChoKSxkZXN0cm95OigpPT57dygpLFI/LmNsb3NlKCksci5jbG9zZSgpLGc9ITEscD0hMSxDKCl9LHNldEhhbmRsZXJzOmg9PntsZXR7c2lnbmFsOmssLi4ueH09aDtPYmplY3QuYXNzaWduKGEseCksYS5kYXRhJiZ1Lmxlbmd0aD4wJiZ1LnNwbGljZSgwKS5mb3JFYWNoKG5lPT5hLmRhdGE/LihuZSkpLGsmJnYoayksKGEudHJhY2t8fGEuc3RyZWFtKSYmZC5sZW5ndGg+MCYmZC5zcGxpY2UoMCkuZm9yRWFjaCgoe3RyYWNrOm5lLHN0cmVhbTp0ZX0pPT57YS50cmFjaz8uKG5lLHRlKSxhLnN0cmVhbT8uKHRlKX0pfSxvZmZlclByb21pc2U6cSxhZGRTdHJlYW06aD0+aC5nZXRUcmFja3MoKS5mb3JFYWNoKGs9PnIuYWRkVHJhY2soayxoKSkscmVtb3ZlU3RyZWFtOmg9PnIuZ2V0U2VuZGVycygpLmZpbHRlcihrPT5rLnRyYWNrJiZoLmdldFRyYWNrcygpLmluY2x1ZGVzKGsudHJhY2spKS5mb3JFYWNoKGs9PnIucmVtb3ZlVHJhY2soaykpLGFkZFRyYWNrOihoLGspPT5yLmFkZFRyYWNrKGgsaykscmVtb3ZlVHJhY2s6aD0+e2xldCBrPXIuZ2V0U2VuZGVycygpLmZpbmQoeD0+eC50cmFjaz09PWgpO2smJnIucmVtb3ZlVHJhY2soayl9LHJlcGxhY2VUcmFjazooaCxrKT0+e2xldCB4PXIuZ2V0U2VuZGVycygpLmZpbmQobmU9Pm5lLnRyYWNrPT09aCk7aWYoeClyZXR1cm4geC5yZXBsYWNlVHJhY2soayl9fX0sT289Wy4uLmJlKDMsKGUsbik9PmBzdHVuOnN0dW4ke258fCIifS5sLmdvb2dsZS5jb206MTkzMDJgKSwic3R1bjpzdHVuLmNsb3VkZmxhcmUuY29tOjM0NzgiXS5tYXAoZT0+KHt1cmxzOmV9KSk7dmFyIENvPU9iamVjdC5nZXRQcm90b3R5cGVPZihVaW50OEFycmF5KSxGbj0zMixEbz0wLHpuPTMyLGFyPTM0LEpuPTM1LGZuPTM2LHhlPTE2KjIqKjEwLWZuLFplPTI1NSxMbz02NTUzNSxpcj0iYnVmZmVyZWRhbW91bnRsb3ciLGNyPSJjbG9zZSIsZnI9ImVycm9yIix4bz0xZTQsSG89ZT0+ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyP25ldyBVaW50OEFycmF5KGUpOm5ldyBVaW50OEFycmF5KGUuYnVmZmVyLGUuYnl0ZU9mZnNldCxlLmJ5dGVMZW5ndGgpLF9vPShlLG49eG8pPT5lLnJlYWR5U3RhdGUhPT0ib3BlbiJ8fGUuYnVmZmVyZWRBbW91bnQ8PWUuYnVmZmVyZWRBbW91bnRMb3dUaHJlc2hvbGQ/UHJvbWlzZS5yZXNvbHZlKGUucmVhZHlTdGF0ZT09PSJvcGVuIik6bmV3IFByb21pc2UodD0+e2xldCBvPSExLGk9bnVsbCxzPWM9PntvfHwobz0hMCxlLnJlbW92ZUV2ZW50TGlzdGVuZXIoaXIsciksZS5yZW1vdmVFdmVudExpc3RlbmVyKGNyLGEpLGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihmcixhKSxfKGkpLHQoYykpfSxyPSgpPT5zKCEwKSxhPSgpPT5zKCExKTtpZihlLmFkZEV2ZW50TGlzdGVuZXIoaXIsciksZS5hZGRFdmVudExpc3RlbmVyKGNyLGEpLGUuYWRkRXZlbnRMaXN0ZW5lcihmcixhKSxpPXNldFRpbWVvdXQoKCk9PnMoITEpLG4pLGUucmVhZHlTdGF0ZSE9PSJvcGVuIil7cyghMSk7cmV0dXJufWUuYnVmZmVyZWRBbW91bnQ8PWUuYnVmZmVyZWRBbW91bnRMb3dUaHJlc2hvbGQmJnMoITApfSksbHI9KHtnZXRQZWVyOmUsZ2V0UGVlcklkczpuLGNhblJlY2VpdmVGcm9tUGVlcjp0LHRocm93SWZBYm9ydGVkOm99KT0+e2xldCBpPXt9LHM9e30scj17fSxhPXt9LGM9KGYsZCx7aW5jbHVkZVBlbmRpbmc6Zz0hMX09e30pPT4oZj9BcnJheS5pc0FycmF5KGYpP2Y6W2ZdOm4oZykpLmZsYXRNYXAocD0+e2xldCBSPWUocCxnKTtyZXR1cm4gUj9bUHJvbWlzZS5yZXNvbHZlKGQocCxSKSldOihjb25zb2xlLndhcm4oYCR7R306IG5vIHBlZXIgd2l0aCBpZCAke3B9IGZvdW5kYCksW10pfSk7cmV0dXJue21ha2VJbnRlcm5hbEFjdGlvbjooZixkPXt9KT0+e2xldCBnPXNbZl07aWYoaVtmXSYmZyl7bGV0IHc9aVtmXS5vcHRpb25zO2lmKHcuc2VuZFRvUGVuZGluZyE9PSEhZC5zZW5kVG9QZW5kaW5nfHx3LnJlY2VpdmVXaGlsZVBlbmRpbmchPT0hIWQucmVjZWl2ZVdoaWxlUGVuZGluZyl0aHJvdyBJKGBhY3Rpb24gdHlwZSAiJHtmfSIgY2Fubm90IGJlIHJlZGVmaW5lZGApO3JldHVybiBnfWlmKCFmKXRocm93IEkoImFjdGlvbiB0eXBlIGFyZ3VtZW50IGlzIHJlcXVpcmVkIik7bGV0IHA9ZGUoZik7aWYocC5ieXRlTGVuZ3RoPkZuKXRocm93IEkoYGFjdGlvbiB0eXBlIHN0cmluZyAiJHtmfSIgKCR7cC5ieXRlTGVuZ3RofWIpIGV4Y2VlZHMgYnl0ZSBsaW1pdCAoJHtGbn0pLiBIaW50OiBjaG9vc2UgYSBzaG9ydGVyIG5hbWUuYCk7bGV0IFI9e3NlbmRUb1BlbmRpbmc6ISFkLnNlbmRUb1BlbmRpbmcscmVjZWl2ZVdoaWxlUGVuZGluZzohIWQucmVjZWl2ZVdoaWxlUGVuZGluZ30sYj1uZXcgVWludDhBcnJheShGbik7Yi5zZXQocCk7bGV0IEI9MDtyZXR1cm4gaVtmXT17b25Db21wbGV0ZTpWLG9uUHJvZ3Jlc3M6VixzZXRPbkNvbXBsZXRlOnc9PntpW2ZdLm9uQ29tcGxldGU9dztsZXQgQz1hW2ZdO0M/Lmxlbmd0aCYmKGRlbGV0ZSBhW2ZdLEMuZm9yRWFjaCgoe3BheWxvYWQ6SCxwZWVySWQ6dixtZXRhZGF0YTpBfSk9PncoSCx2LEEpKSl9LHNldE9uUHJvZ3Jlc3M6dz0+e2lbZl0ub25Qcm9ncmVzcz13fSxzZW5kOmFzeW5jKHcsQyxILHYsQSk9PntvKEEpO2xldCBLPXR5cGVvZiB3O2lmKEs9PT0idW5kZWZpbmVkIil0aHJvdyBJKCJhY3Rpb24gZGF0YSBjYW5ub3QgYmUgdW5kZWZpbmVkIik7bGV0IFQ9SyE9PSJzdHJpbmciLCQ9dyBpbnN0YW5jZW9mIEJsb2Isej0kfHx3IGluc3RhbmNlb2YgQXJyYXlCdWZmZXJ8fHcgaW5zdGFuY2VvZiBDbyxqPUghPT12b2lkIDAsVz16P0hvKCQ/YXdhaXQgdy5hcnJheUJ1ZmZlcigpOncpOmRlKFQ/Wih3KTp3KSxlZT1qP2RlKFooSCkpOm51bGwsbT1NYXRoLmNlaWwoVy5ieXRlTGVuZ3RoL3hlKSsoaj8xOjApfHwxLHk9YmUobSwoUyxQKT0+e2xldCBNPVA9PT1tLTEsTj0hIShqJiZQPT09MCkscT1uZXcgVWludDhBcnJheShmbisoTj9lZT8uYnl0ZUxlbmd0aD8/MDpNP1cuYnl0ZUxlbmd0aC14ZSoobS0oaj8yOjEpKTp4ZSkpO3JldHVybiBxLnNldChiKSxxLnNldChbQj4+OCxCJlplXSx6bikscS5zZXQoW051bWJlcihNKXxOdW1iZXIoTik8PDF8TnVtYmVyKHopPDwyfE51bWJlcihUKTw8M10sYXIpLHEuc2V0KFtNYXRoLnJvdW5kKChQKzEpL20qWmUpXSxKbikscS5zZXQoaj9OP2VlPz9uZXcgVWludDhBcnJheTpXLnN1YmFycmF5KChQLTEpKnhlLFAqeGUpOlcuc3ViYXJyYXkoUCp4ZSwoUCsxKSp4ZSksZm4pLHF9KTtyZXR1cm4gQj1CKzEmTG8sYXdhaXQgYWUoYyhDLGFzeW5jKFMsUCk9PntsZXR7Y2hhbm5lbDpNfT1QLE49MDtmb3IoO048bTspe28oQSk7bGV0IHE9eVtOXTtpZighcSlicmVhaztpZihNJiZNLmJ1ZmZlcmVkQW1vdW50Pk0uYnVmZmVyZWRBbW91bnRMb3dUaHJlc2hvbGQpe2xldCB4PWF3YWl0IF9vKE0pO2lmKG8oQSksIXgpYnJlYWt9bGV0IGg9ZShTLFIuc2VuZFRvUGVuZGluZyk7aWYoIWh8fGghPT1QKWJyZWFrO1Auc2VuZERhdGEocSksTisrO2xldCBrPXFbSm5dPz9aZTt2Py4oay9aZSxTLEgpfX0se2luY2x1ZGVQZW5kaW5nOlIuc2VuZFRvUGVuZGluZ30pKSxbXX0sb3B0aW9uczpSfSxzW2ZdPXtzZW5kOmlbZl0uc2VuZCxvbk1lc3NhZ2U6aVtmXS5zZXRPbkNvbXBsZXRlLG9uUHJvZ3Jlc3M6aVtmXS5zZXRPblByb2dyZXNzfX0saGFuZGxlRGF0YTooZixkKT0+e2xldCBnPW5ldyBVaW50OEFycmF5KGQpLHA9Z2UoZy5zdWJhcnJheShEbyx6bikpLnJlcGxhY2VBbGwoIlwwIiwiIiksUj1pW3BdO2lmKCF0KGYsISFSPy5vcHRpb25zLnJlY2VpdmVXaGlsZVBlbmRpbmcpKXJldHVybjtsZXQgYj0oZ1t6bl0/PzApPDw4fChnWzMzXT8/MCksQj1nW2FyXT8/MCx3PWdbSm5dPz8wLEM9Zy5zdWJhcnJheShmbiksSD0hIShCJjEpLHY9ISEoQiYyKSxBPSEhKEImNCksSz0hIShCJjgpO3JbZl0/Pz17fSxyW2ZdW3BdPz89e307bGV0IFQ9cltmXVtwXVtiXT8/PXtjaHVua3M6W119O2lmKHY/VC5tZXRhPWhlKGdlKEMpKTpULmNodW5rcy5wdXNoKEMpLFI/Lm9uUHJvZ3Jlc3Mody9aZSxmLFQubWV0YSksIUgpcmV0dXJuO2xldCAkPW5ldyBVaW50OEFycmF5KFQuY2h1bmtzLnJlZHVjZSgoaixXKT0+aitXLmJ5dGVMZW5ndGgsMCkpO1QuY2h1bmtzLnJlZHVjZSgoaixXKT0+KCQuc2V0KFcsaiksaitXLmJ5dGVMZW5ndGgpLDApLGRlbGV0ZSByW2ZdW3BdW2JdO2xldCB6PUE/JDpLP2hlKGdlKCQpKTpnZSgkKTtpZihSKXtSLm9uQ29tcGxldGUoeixmLFQubWV0YSk7cmV0dXJufShhW3BdPz89W10pLnB1c2goe3BheWxvYWQ6eixwZWVySWQ6ZiwuLi5ULm1ldGE9PT12b2lkIDA/e306e21ldGFkYXRhOlQubWV0YX19KX0sY2xlYXJQZWVyOmY9PntkZWxldGUgcltmXX19fTt2YXIgSW89NTAwLEtlPShlLG4pPT57bGV0IHQ9SShuKTtyZXR1cm4gdC5raW5kPWUsdC5uYW1lPWU9PT0iYWJvcnRlZCI/IkFib3J0RXJyb3IiOnQubmFtZSx0fSxWbj1lPT57aWYoZT8uYWJvcnRlZCl0aHJvdyBLZSgiYWJvcnRlZCIsIm9wZXJhdGlvbiBhYm9ydGVkIil9LHVyPWU9PmUmJnR5cGVvZiBlPT0ib2JqZWN0IiYmIUFycmF5LmlzQXJyYXkoZSkmJnR5cGVvZiBlLnI9PSJzdHJpbmciP3tyOmUuciwuLi5PYmplY3QuaGFzT3duKGUsIm0iKT97bTplLm19Ont9fTpudWxsLE5vPWU9PmUmJnR5cGVvZiBlPT0ib2JqZWN0IiYmIUFycmF5LmlzQXJyYXkoZSkmJnR5cGVvZiBlLnI9PSJzdHJpbmciP3tyOmUuciwuLi50eXBlb2YgZS5lPT0ic3RyaW5nIj97ZTplLmV9Ont9fTpudWxsLGxuPShlLG4pPT5uPT09dm9pZCAwP2U6ey4uLmUsbWV0YWRhdGE6bn0sZHI9KHtnZXRQZWVyOmUsZ2V0UGVlcklkczpuLGNhblJlY2VpdmVGcm9tUGVlcjp0fSk9PntsZXQgbz17fSxpPXt9LHM9bHIoe2dldFBlZXI6ZSxnZXRQZWVySWRzOm4sY2FuUmVjZWl2ZUZyb21QZWVyOnQsdGhyb3dJZkFib3J0ZWQ6Vm59KSxyPXMubWFrZUludGVybmFsQWN0aW9uLGE9cy5oYW5kbGVEYXRhLGM9Zz0+e2xldCBwPWlbZ107cCYmKF8ocC50aW1lcikscC5zaWduYWwmJnAuYWJvcnRIYW5kbGVyJiZwLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKCJhYm9ydCIscC5hYm9ydEhhbmRsZXIpLGRlbGV0ZSBpW2ddKX0sdT0oZyxwKT0+e21lKGkpLmZvckVhY2goKFtSLGJdKT0+e2IucGVlcklkPT09ZyYmKGMoUiksYi5yZWplY3QocCkpfSl9LGw9KGcscCk9PntzLmNsZWFyUGVlcihnKSx1KGcsS2UoImRpc2Nvbm5lY3RlZCIsUGUocCwicGVlciBkaXNjb25uZWN0ZWQiKSkpfSxmPXIoIkBfcmVzcG9uc2UiKTtyZXR1cm4gZi5vbk1lc3NhZ2UoKGcscCxSKT0+e2xldCBiPU5vKFIpO2lmKCFiKXJldHVybjtsZXQgQj1pW2Iucl07aWYoISghQnx8Qi5wZWVySWQhPT1wKSl7aWYoYyhiLnIpLGIuZSE9PXZvaWQgMCl7Qi5yZWplY3QoS2UoInJlamVjdGVkIixiLmUpKTtyZXR1cm59Qi5yZXNvbHZlKGcpfX0pLHttYWtlQWN0aW9uOihnLHApPT57aWYocCYmIm9uUmVxdWVzdCJpbiBwJiZwLmtpbmQhPT0icmVxdWVzdCIpdGhyb3cgSSgncmVxdWVzdCBhY3Rpb25zIG11c3QgdXNlIGtpbmQ6ICJyZXF1ZXN0IicpO2xldCBSPXA/LmtpbmQ/PyJtZXNzYWdlIixiPXIoZyksQj1vW2ddO2lmKEIpe2lmKEIua2luZCE9PVIpdGhyb3cgSShgYWN0aW9uIHR5cGUgIiR7Z30iIGNhbm5vdCBiZSByZWRlZmluZWRgKTtyZXR1cm4gQi5hY3Rpb259bGV0IHc9e2tpbmQ6UixhY3Rpb246bnVsbCxwZW5kaW5nTWVzc2FnZXM6W10scGVuZGluZ1JlcXVlc3RzOltdLG9uUmVjZWl2ZVByb2dyZXNzOnA/Lm9uUmVjZWl2ZVByb2dyZXNzPz9udWxsfSxDPShtLHkpPT5tPyhTLFApPT5tKFMsbG4oe3BlZXJJZDpQfSx5KSk6dm9pZCAwLEg9bT0+e3cub25SZWNlaXZlUHJvZ3Jlc3M9bX0sdj0obSx5LFMpPT57bGV0IFA9dy5raW5kPT09InJlcXVlc3QiP3VyKFMpOm51bGw7dy5vblJlY2VpdmVQcm9ncmVzcz8uKG0sbG4oe3BlZXJJZDp5fSxQP1AubTpTKSl9O2lmKGIub25Qcm9ncmVzcyh2KSxSPT09Im1lc3NhZ2UiKXtsZXQgbT1wPy5vbk1lc3NhZ2U/P251bGwseT0oKT0+e2lmKCFtKXJldHVybjtsZXQgUD1tO3cucGVuZGluZ01lc3NhZ2VzLnNwbGljZSgwKS5mb3JFYWNoKCh7cGF5bG9hZDpNLHBlZXJJZDpOLG1ldGFkYXRhOnF9KT0+e1Byb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PlAoTSxsbih7cGVlcklkOk59LHEpKSkuY2F0Y2goaD0+Y29uc29sZS5lcnJvcihgJHtHfSBhY3Rpb24gaGFuZGxlciBlcnJvcjpgLGgpKX0pfSxTPXtzZW5kOmFzeW5jKFAsTT17fSk9Pnthd2FpdCBiLnNlbmQoUCxNLnRhcmdldCxNLm1ldGFkYXRhLEMoTS5vblByb2dyZXNzLE0ubWV0YWRhdGEpLE0uc2lnbmFsKX0sZ2V0IG9uTWVzc2FnZSgpe3JldHVybiBtfSxzZXQgb25NZXNzYWdlKFApe209UCx5KCl9LGdldCBvblJlY2VpdmVQcm9ncmVzcygpe3JldHVybiB3Lm9uUmVjZWl2ZVByb2dyZXNzfSxzZXQgb25SZWNlaXZlUHJvZ3Jlc3MoUCl7SChQKX19O3JldHVybiBiLm9uTWVzc2FnZSgoUCxNLE4pPT57aWYoIW0pe3cucGVuZGluZ01lc3NhZ2VzLnB1c2goTj09PXZvaWQgMD97cGF5bG9hZDpQLHBlZXJJZDpNfTp7cGF5bG9hZDpQLHBlZXJJZDpNLG1ldGFkYXRhOk59KTtyZXR1cm59bGV0IHE9bTtQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT5xKFAsbG4oe3BlZXJJZDpNfSxOKSkpLmNhdGNoKGg9PmNvbnNvbGUuZXJyb3IoYCR7R30gYWN0aW9uIGhhbmRsZXIgZXJyb3I6YCxoKSl9KSx3LmFjdGlvbj1TLG9bZ109dyx5KCksU31sZXQgQT1wPy5vblJlcXVlc3Q/P251bGwsSz1tPT57XyhtLnRpbWVyKTtsZXQgeT13LnBlbmRpbmdSZXF1ZXN0cy5pbmRleE9mKG0pO3k+LTEmJncucGVuZGluZ1JlcXVlc3RzLnNwbGljZSh5LDEpfSxUPShtLHksUyk9PntmLnNlbmQobnVsbCxtLHtyOnksZTpQZShTLCJyZXF1ZXN0IGZhaWxlZCIpfSl9LCQ9KG0seSk9PntLKG0pLFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PnkobS5wYXlsb2FkLHtwZWVySWQ6bS5wZWVySWQsLi4ubS5tZXRhZGF0YT09PXZvaWQgMD97fTp7bWV0YWRhdGE6bS5tZXRhZGF0YX0sc2lnbmFsOm0uY29udHJvbGxlci5zaWduYWx9KSkudGhlbihhc3luYyBTPT57aWYoUz09PXZvaWQgMCl0aHJvdyBJKCJyZXF1ZXN0IGhhbmRsZXIgcmV0dXJuZWQgdW5kZWZpbmVkIik7YXdhaXQgZi5zZW5kKFMsbS5wZWVySWQse3I6bS5yZXF1ZXN0SWR9KX0pLmNhdGNoKFM9PlQobS5wZWVySWQsbS5yZXF1ZXN0SWQsUykpLmZpbmFsbHkoKCk9Pm0uY29udHJvbGxlci5hYm9ydCgpKX0sej0oKT0+e0EmJncucGVuZGluZ1JlcXVlc3RzLnNsaWNlKCkuZm9yRWFjaChtPT4kKG0sQSkpfSxqPShtLHksUyxQKT0+e2lmKEEpe2xldCBOPXtwYXlsb2FkOm0scGVlcklkOnksLi4uUz09PXZvaWQgMD97fTp7bWV0YWRhdGE6U30scmVxdWVzdElkOlAsY29udHJvbGxlcjpuZXcgQWJvcnRDb250cm9sbGVyLHRpbWVyOm51bGx9OyQoTixBKTtyZXR1cm59bGV0IE09e3BheWxvYWQ6bSxwZWVySWQ6eSwuLi5TPT09dm9pZCAwP3t9OnttZXRhZGF0YTpTfSxyZXF1ZXN0SWQ6UCxjb250cm9sbGVyOm5ldyBBYm9ydENvbnRyb2xsZXIsdGltZXI6c2V0VGltZW91dCgoKT0+e0soTSksTS5jb250cm9sbGVyLmFib3J0KCksVCh5LFAsInJlcXVlc3QgaGFuZGxlciB1bmF2YWlsYWJsZSIpfSxJbyl9O3cucGVuZGluZ1JlcXVlc3RzLnB1c2goTSl9LFc9YXN5bmMobSx5KT0+e2xldHt0YXJnZXQ6UyxtZXRhZGF0YTpQLG9uUHJvZ3Jlc3M6TSxzaWduYWw6Tix0aW1lb3V0TXM6cX09eTtpZihWbihOKSwhZShTLCExKSl0aHJvdyBLZSgiZGlzY29ubmVjdGVkIixgbm8gYWN0aXZlIHBlZXIgd2l0aCBpZCAke1N9YCk7bGV0IGg9bGUoMjApLGs9bmV3IFByb21pc2UoKHgsbmUpPT57bGV0IHRlPXtwZWVySWQ6UyxyZXNvbHZlOngscmVqZWN0Om5lLHRpbWVyOm51bGwsLi4uTj09PXZvaWQgMD97fTp7c2lnbmFsOk59fSwkZT0oKT0+e2MoaCksbmUoS2UoImFib3J0ZWQiLCJvcGVyYXRpb24gYWJvcnRlZCIpKX07TiYmKHRlLmFib3J0SGFuZGxlcj0kZSxOLmFkZEV2ZW50TGlzdGVuZXIoImFib3J0IiwkZSx7b25jZTohMH0pKSxpW2hdPXRlfSkuY2F0Y2goeD0+e3Rocm93IHh9KTt0cnl7YXdhaXQgYi5zZW5kKG0sUyxQPT09dm9pZCAwP3tyOmh9OntyOmgsbTpQfSxDKE0sUCksTik7bGV0IHg9aVtoXTtyZXR1cm4geCYmcSE9PXZvaWQgMCYmKHgudGltZXI9c2V0VGltZW91dCgoKT0+e2MoaCkseC5yZWplY3QoS2UoInRpbWVvdXQiLCJyZXF1ZXN0IHRpbWVkIG91dCIpKX0scSkpLGF3YWl0IGt9Y2F0Y2goeCl7dGhyb3cgYyhoKSx4fX0sZWU9e3JlcXVlc3Q6VyxyZXF1ZXN0TWFueTphc3luYyhtLHkpPT4oVm4oeS5zaWduYWwpLGF3YWl0IGFlKHkudGFyZ2V0cy5tYXAoYXN5bmMgUz0+e3RyeXtsZXQgUD17cGVlcklkOlMsc3RhdHVzOiJmdWxmaWxsZWQiLHZhbHVlOmF3YWl0IFcobSx7dGFyZ2V0OlMsLi4ueS5tZXRhZGF0YT09PXZvaWQgMD97fTp7bWV0YWRhdGE6eS5tZXRhZGF0YX0sLi4ueS50aW1lb3V0TXM9PT12b2lkIDA/e306e3RpbWVvdXRNczp5LnRpbWVvdXRNc30sLi4ueS5vblByb2dyZXNzPT09dm9pZCAwP3t9OntvblByb2dyZXNzOnkub25Qcm9ncmVzc30sLi4ueS5zaWduYWw9PT12b2lkIDA/e306e3NpZ25hbDp5LnNpZ25hbH19KX07cmV0dXJuIHkub25SZXN1bHQ/LihQKSxQfWNhdGNoKFApe2xldCBNPXVlKFAsInJlcXVlc3QgZmFpbGVkIik7aWYoTS5raW5kPT09ImFib3J0ZWQifHwhTS5raW5kKXRocm93IE07bGV0IE49TS5raW5kPT09InRpbWVvdXQiP3twZWVySWQ6UyxzdGF0dXM6InRpbWVvdXQifTpNLmtpbmQ9PT0iZGlzY29ubmVjdGVkIj97cGVlcklkOlMsc3RhdHVzOiJkaXNjb25uZWN0ZWQifTp7cGVlcklkOlMsc3RhdHVzOiJyZWplY3RlZCIsZXJyb3I6TX07cmV0dXJuIHkub25SZXN1bHQ/LihOKSxOfX0pKSksZ2V0IG9uUmVxdWVzdCgpe3JldHVybiBBfSxzZXQgb25SZXF1ZXN0KG0pe0E9bSx6KCl9LGdldCBvblJlY2VpdmVQcm9ncmVzcygpe3JldHVybiB3Lm9uUmVjZWl2ZVByb2dyZXNzfSxzZXQgb25SZWNlaXZlUHJvZ3Jlc3MobSl7SChtKX19O3JldHVybiBiLm9uTWVzc2FnZSgobSx5LFMpPT57bGV0IFA9dXIoUyk7UCYmaihtLHksUC5tLFAucil9KSx3LmFjdGlvbj1lZSxvW2ddPXcseigpLGVlfSxtYWtlSW50ZXJuYWxBY3Rpb246cixoYW5kbGVEYXRhOmEsY2xlYXJQZWVyOmx9fTt2YXIgbXI9ZT0+ZSYmdHlwZW9mIGU9PSJvYmplY3QiJiYhQXJyYXkuaXNBcnJheShlKSYmdHlwZW9mIGUuaz09InN0cmluZyI/e2tleTplLmssLi4udHlwZW9mIGUucz09InN0cmluZyI/e3N0cmVhbUlkOmUuc306e30sLi4udHlwZW9mIGUudD09InN0cmluZyI/e3RyYWNrSWQ6ZS50fTp7fSwuLi5PYmplY3QuaGFzT3duKGUsIm0iKT97bWV0YWRhdGE6ZS5tfTp7fX06bnVsbCxncj1lPT5uPT57bGV0IHQ9ZS5nZXQobik7cmV0dXJuIHR8fCh0PWxlKDIwKSxlLnNldChuLHQpKSx0fSxHbj0oKT0+e2xldCBlPW5ldyBXZWFrTWFwLG49bmV3IFdlYWtNYXAsdD1uZXcgTWFwLG89bmV3IE1hcCxpPW5ldyBNYXAscz1uZXcgTWFwO3JldHVybntnZXRTdHJlYW1LZXk6Z3IoZSksZ2V0VHJhY2tLZXk6Z3IobikscmVtZW1iZXJSZW1vdGVTdHJlYW06KHIsYSxjKT0+e3Quc2V0KHIsYSksYyYmby5zZXQoYyxhKX0sZ2V0UmVtb3RlU3RyZWFtOihyLGEpPT50LmdldChyKT8/KGE/by5nZXQoYSk6dm9pZCAwKSxyZW1lbWJlclJlbW90ZVRyYWNrOihyLGEsYyx1LGwpPT57bGV0IGY9e3RyYWNrOmEsc3RyZWFtOmN9O2kuc2V0KHIsZiksdSYmcy5zZXQodSxmKSxsJiZvLnNldChsLGMpfSxnZXRSZW1vdGVUcmFjazoocixhKT0+aS5nZXQocik/PyhhP3MuZ2V0KGEpOnZvaWQgMCksY2xlYXJSZW1vdGU6KCk9Pnt0LmNsZWFyKCksby5jbGVhcigpLGkuY2xlYXIoKSxzLmNsZWFyKCl9fX0saHI9KHtpdGVyYXRlOmUsaXNBY3RpdmU6bixnZXRTaGFyZWRNZWRpYVBlZXI6dH0pPT57bGV0IG89e30saT17fSxzPUduKCkscj17b25QZWVyU3RyZWFtOm51bGwsb25QZWVyVHJhY2s6bnVsbH0sYT0obCxmLGQsZyk9PntuKGwpJiYodChsKT8uX190cnlzdGVyb01lZGlhPy5yZW1lbWJlclJlbW90ZVN0cmVhbShmLGQsdHlwZW9mIGQuaWQ9PSJzdHJpbmciP2QuaWQ6dm9pZCAwKSxyLm9uUGVlclN0cmVhbT8uKGQsbCxnKSl9LGM9KGwsZixkLGcscCk9PntuKGwpJiYodChsKT8uX190cnlzdGVyb01lZGlhPy5yZW1lbWJlclJlbW90ZVRyYWNrKGYsZCxnLHR5cGVvZiBkLmlkPT0ic3RyaW5nIj9kLmlkOnZvaWQgMCx0eXBlb2YgZy5pZD09InN0cmluZyI/Zy5pZDp2b2lkIDApLHIub25QZWVyVHJhY2s/LihkLGcsbCxwKSl9LHU9KGwsZixkLGcscCxSPXt9KT0+e2xldCBiPXtrOmYsLi4uUiwuLi5kPT09dm9pZCAwP3t9OnttOmR9fTtyZXR1cm4gZShsLGFzeW5jKEIsdyk9Pnthd2FpdCBnKGIsQikscCh3KX0pfTtyZXR1cm57YWRkU3RyZWFtOihsLGYsZCk9PnUoZi50YXJnZXQscy5nZXRTdHJlYW1LZXkobCksZi5tZXRhZGF0YSxkLGc9PmcuYWRkU3RyZWFtKGwpLHtzOmwuaWR9KSxyZW1vdmVTdHJlYW06KGwsZik9PntlKGYsKGQsZyk9PmcucmVtb3ZlU3RyZWFtKGwpKX0sYWRkVHJhY2s6KGwsZixkLGcpPT51KGQudGFyZ2V0LHMuZ2V0VHJhY2tLZXkobCksZC5tZXRhZGF0YSxnLHA9PnAuYWRkVHJhY2sobCxmKSx7czpmLmlkLHQ6bC5pZH0pLHJlbW92ZVRyYWNrOihsLGYpPT57ZShmLChkLGcpPT5nLnJlbW92ZVRyYWNrKGwpKX0scmVwbGFjZVRyYWNrOihsLGYsZCxnKT0+dShkLnRhcmdldCxzLmdldFRyYWNrS2V5KGYpLGQubWV0YWRhdGEsZyxwPT5wLnJlcGxhY2VUcmFjayhsLGYpLHt0OmwuaWR9KSxyZWNlaXZlU3RyZWFtTWV0YToobCxmKT0+e2lmKCFuKGYpKXJldHVybjtsZXQgZD1tcihsKTtpZighZClyZXR1cm47bGV0IGc9dChmKT8uX190cnlzdGVyb01lZGlhPy5nZXRSZW1vdGVTdHJlYW0oZC5rZXksZC5zdHJlYW1JZCk7aWYoZyl7YShmLGQua2V5LGcsZC5tZXRhZGF0YSk7cmV0dXJufShvW2ZdPz89W10pLnB1c2goZCl9LHJlY2VpdmVUcmFja01ldGE6KGwsZik9PntpZighbihmKSlyZXR1cm47bGV0IGQ9bXIobCk7aWYoIWQpcmV0dXJuO2xldCBnPXQoZik/Ll9fdHJ5c3Rlcm9NZWRpYT8uZ2V0UmVtb3RlVHJhY2soZC5rZXksZC50cmFja0lkKTtpZihnKXtjKGYsZC5rZXksZy50cmFjayxnLnN0cmVhbSxkLm1ldGFkYXRhKTtyZXR1cm59KGlbZl0/Pz1bXSkucHVzaChkKX0scmVjZWl2ZVJlbW90ZVN0cmVhbToobCxmKT0+e2lmKCFuKGwpKXJldHVybjtsZXQgZD1vW2xdPy5zaGlmdCgpO2QmJmEobCxkLmtleSxmLGQubWV0YWRhdGEpfSxyZWNlaXZlUmVtb3RlVHJhY2s6KGwsZixkKT0+e2lmKCFuKGwpKXJldHVybjtsZXQgZz1pW2xdPy5zaGlmdCgpO2cmJmMobCxnLmtleSxmLGQsZy5tZXRhZGF0YSl9LGNsZWFyUGVlcjpsPT57ZGVsZXRlIG9bbF0sZGVsZXRlIGlbbF19LGdldCBvblBlZXJTdHJlYW0oKXtyZXR1cm4gci5vblBlZXJTdHJlYW19LHNldCBvblBlZXJTdHJlYW0obCl7ci5vblBlZXJTdHJlYW09bH0sZ2V0IG9uUGVlclRyYWNrKCl7cmV0dXJuIHIub25QZWVyVHJhY2t9LHNldCBvblBlZXJUcmFjayhsKXtyLm9uUGVlclRyYWNrPWx9fX07dmFyIHByPSJiZWZvcmV1bmxvYWQiLFVvPTFlNCxSZT1lPT4iQF8iK2UsWGU9bmV3IFNldCx5cj0oKT0+WGUuZm9yRWFjaChlPT5lKCkpLEtvPWU9PihYZS5hZGQoZSksWGUuc2l6ZT09PTEmJmFkZEV2ZW50TGlzdGVuZXIocHIseXIpLCgpPT57WGUuZGVsZXRlKGUpLFhlLnNpemV8fHJlbW92ZUV2ZW50TGlzdGVuZXIocHIseXIpfSksd3I9KGUsbix0LHtvblBlZXJIYW5kc2hha2U6byxvbkhhbmRzaGFrZUVycm9yOmksaGFuZHNoYWtlVGltZW91dE1zOnM9VW8saXNQYXNzaXZlOnI9ITF9PXt9KT0+e2xldCBhPXt9LGM9e30sdT17fSxsPXtvblBlZXJKb2luOm51bGwsb25QZWVyTGVhdmU6bnVsbH0sZj1WLGQ9bnVsbCxnPShtLHkse2luY2x1ZGVQZW5kaW5nOlM9ITF9PXt9KT0+KG0/QXJyYXkuaXNBcnJheShtKT9tOlttXTpRKFM/YTpjKSkuZmxhdE1hcChQPT57bGV0IE09Uz9hW1BdOmNbUF07cmV0dXJuIE0/W1Byb21pc2UucmVzb2x2ZSh5KFAsTSkpXTooY29uc29sZS53YXJuKGAke0d9OiBubyBwZWVyIHdpdGggaWQgJHtQfSBmb3VuZGApLFtdKX0pLHA9aHIoe2l0ZXJhdGU6KG0seSk9PmcobSwoUyxQKT0+eShTLFApKSxpc0FjdGl2ZTptPT4hIWNbbV0sZ2V0U2hhcmVkTWVkaWFQZWVyOm09PmFbbV0/P251bGx9KSxSPWRyKHtnZXRQZWVyOihtLHkpPT4oeT9hOmMpW21dLGdldFBlZXJJZHM6bT0+UShtP2E6YyksY2FuUmVjZWl2ZUZyb21QZWVyOihtLHkpPT4hIWQ/LmNhblJlY2VpdmVGcm9tUGVlcihtLHkpfSksYj1SLm1ha2VJbnRlcm5hbEFjdGlvbixCPVIuaGFuZGxlRGF0YSx3PVIubWFrZUFjdGlvbixDPShtLHk9SSgicGVlciBkaXNjb25uZWN0ZWQiKSk9PntsZXQgUz11ZSh5LCJwZWVyIGRpc2Nvbm5lY3RlZCIpO2Q/LmNsZWFyUGVlcihtLFMpLGRlbGV0ZSBhW21dLGRlbGV0ZSBjW21dLFIuY2xlYXJQZWVyKG0sUyksdVttXT8uc3BsaWNlKDApLmZvckVhY2goUD0+UC5yZWplY3QoUykpLGRlbGV0ZSB1W21dLHAuY2xlYXJQZWVyKG0pfSxIPShtLHksUyk9PntsZXQgUD1hW21dO2lmKCFQfHx5JiZQIT09eSlyZXR1cm47bGV0IE09ISFjW21dO0MobSxTKSxQLmRlc3Ryb3koKSxNJiZsLm9uUGVlckxlYXZlPy4obSksbihtKX0sdj1hc3luYygpPT57YXdhaXQgai5zZW5kKCIiKSxhd2FpdCBuZXcgUHJvbWlzZShtPT5zZXRUaW1lb3V0KG0sOTkpKSxtZShhKS5mb3JFYWNoKChbbSx5XSk9Pnt5LmRlc3Ryb3koKSxDKG0sSSgicm9vbSBsZWZ0IikpfSksZigpLHQoKX0sQT1iKFJlKCJwaW5nIikpLEs9YihSZSgicG9uZyIpKSxUPWIoUmUoInNpZ25hbCIpKSwkPWIoUmUoInN0cmVhbSIpKSx6PWIoUmUoInRyYWNrIikpLGo9YihSZSgibGVhdmUiKSx7c2VuZFRvUGVuZGluZzohMCxyZWNlaXZlV2hpbGVQZW5kaW5nOiEwfSksVz1iKFJlKCJoc2RhdGEiKSx7c2VuZFRvUGVuZGluZzohMCxyZWNlaXZlV2hpbGVQZW5kaW5nOiEwfSksZWU9YihSZSgiaHNyZWFkeSIpLHtzZW5kVG9QZW5kaW5nOiEwLHJlY2VpdmVXaGlsZVBlbmRpbmc6ITB9KTtyZXR1cm4gZD1ycih7Li4ubz09PXZvaWQgMD97fTp7b25QZWVySGFuZHNoYWtlOm99LC4uLmk9PT12b2lkIDA/e306e29uSGFuZHNoYWtlRXJyb3I6aX0saGFuZHNoYWtlVGltZW91dE1zOnMsc2VuZEhhbmRzaGFrZURhdGE6Vy5zZW5kLHNlbmRIYW5kc2hha2VSZWFkeTplZS5zZW5kLG9uQWN0aXZhdGU6KG0seSk9PntjW21dPXksbC5vblBlZXJKb2luPy4obSl9LG9uRmFpbHVyZToobSx5LFMpPT5IKG0seSxTKX0pLEEub25NZXNzYWdlKChtLHkpPT5LLnNlbmQoIiIseSkpLEsub25NZXNzYWdlKChtLHkpPT57bGV0IFM9dVt5XTtTPy5zaGlmdCgpPy5yZXNvbHZlKCksUyYmIVMubGVuZ3RoJiZkZWxldGUgdVt5XX0pLFQub25NZXNzYWdlKChtLHkpPT57Y1t5XSYmYVt5XT8uc2lnbmFsKG0pfSksJC5vbk1lc3NhZ2UoKG0seSk9PnAucmVjZWl2ZVN0cmVhbU1ldGEobSx5KSksei5vbk1lc3NhZ2UoKG0seSk9PnAucmVjZWl2ZVRyYWNrTWV0YShtLHkpKSxqLm9uTWVzc2FnZSgobSx5KT0+SCh5LHZvaWQgMCxJKCJwZWVyIGxlZnQgcm9vbSIpKSksVy5vbk1lc3NhZ2UoKG0seSxTKT0+ZD8ucmVjZWl2ZUhhbmRzaGFrZURhdGEobSx5LFMpKSxlZS5vbk1lc3NhZ2UoKG0seSk9PmQ/LnJlY2VpdmVIYW5kc2hha2VSZWFkeSh5KSksZSgobSx5KT0+e2xldCBTPWFbeV07aWYoUyl7aWYoUz09PW0pcmV0dXJuO1MuZGVzdHJveSgpLEMoeSxJKCJwZWVyIHJlcGxhY2VkIikpfWFbeV09bSxkPy5hZGRQZWVyKHksbSksbS5zZXRIYW5kbGVycyh7ZGF0YTpQPT5CKHksUCksc3RyZWFtOlA9PnAucmVjZWl2ZVJlbW90ZVN0cmVhbSh5LFApLHRyYWNrOihQLE0pPT5wLnJlY2VpdmVSZW1vdGVUcmFjayh5LFAsTSksc2lnbmFsOlA9PntjW3ldJiZULnNlbmQoUCx5KX0sY2xvc2U6KCk9PkgoeSxtLEkoInBlZXIgZGlzY29ubmVjdGVkIikpLGVycm9yOlA9Pntjb25zb2xlLmVycm9yKGAke0d9IHBlZXIgZXJyb3I6YCxQKSxIKHksbSxQKX19KSxkPy5zdGFydCh5LG0pfSksSG4mJihmPUtvKCgpPT52KCkuY2F0Y2goVikpKSx7bWFrZUFjdGlvbjp3LGxlYXZlOnYscGluZzphc3luYyBtPT57aWYoIWNbbV0pdGhyb3cgSShgbm8gYWN0aXZlIHBlZXIgd2l0aCBpZCAke219YCk7bGV0IHk9RGF0ZS5ub3coKTtyZXR1cm4gYXdhaXQgbmV3IFByb21pc2UoKFMsUCk9PntsZXQgTT11W21dPz89W10sTj0oKT0+e2xldCBoPXVbbV07aWYoIWgpcmV0dXJuO2xldCBrPWguaW5kZXhPZihxKTtrPi0xJiZoLnNwbGljZShrLDEpLGgubGVuZ3RofHxkZWxldGUgdVttXX0scT17cmVzb2x2ZTooKT0+e04oKSxTKCl9LHJlamVjdDpoPT57TigpLFAoaCl9fTtNLnB1c2gocSksQS5zZW5kKCIiLG0pLmNhdGNoKGg9PnEucmVqZWN0KHVlKGgsInBlZXIgZGlzY29ubmVjdGVkIikpKX0pLERhdGUubm93KCkteX0saXNQYXNzaXZlOigpPT5yLGdldFBlZXJzOigpPT5fbihtZShjKS5tYXAoKFttLHldKT0+W20seS5jb25uZWN0aW9uXSkpLGFkZFN0cmVhbToobSx5PXt9KT0+cC5hZGRTdHJlYW0obSx5LCQuc2VuZCkscmVtb3ZlU3RyZWFtOihtLHk9e30pPT57cC5yZW1vdmVTdHJlYW0obSx5LnRhcmdldCl9LGFkZFRyYWNrOihtLHksUz17fSk9PnAuYWRkVHJhY2sobSx5LFMsei5zZW5kKSxyZW1vdmVUcmFjazoobSx5PXt9KT0+e3AucmVtb3ZlVHJhY2sobSx5LnRhcmdldCl9LHJlcGxhY2VUcmFjazoobSx5LFM9e30pPT5wLnJlcGxhY2VUcmFjayhtLHksUyx6LnNlbmQpLGdldCBvblBlZXJKb2luKCl7cmV0dXJuIGwub25QZWVySm9pbn0sc2V0IG9uUGVlckpvaW4obSl7bC5vblBlZXJKb2luPW0sbSYmUShjKS5mb3JFYWNoKHk9Pm0oeSkpfSxnZXQgb25QZWVyTGVhdmUoKXtyZXR1cm4gbC5vblBlZXJMZWF2ZX0sc2V0IG9uUGVlckxlYXZlKG0pe2wub25QZWVyTGVhdmU9bX0sZ2V0IG9uUGVlclN0cmVhbSgpe3JldHVybiBwLm9uUGVlclN0cmVhbX0sc2V0IG9uUGVlclN0cmVhbShtKXtwLm9uUGVlclN0cmVhbT1tfSxnZXQgb25QZWVyVHJhY2soKXtyZXR1cm4gcC5vblBlZXJUcmFja30sc2V0IG9uUGVlclRyYWNrKG0pe3Aub25QZWVyVHJhY2s9bX19fTt2YXIga3I9MSx2cj0yLFByPShlLG4pPT57bGV0IHQ9ZGUoZSksbz1uZXcgVWludDhBcnJheSgzK3QuYnl0ZUxlbmd0aCtuLmJ5dGVMZW5ndGgpO3JldHVybiBvWzBdPWtyLG9bMV09dC5ieXRlTGVuZ3RoPj4+OCYyNTUsb1syXT10LmJ5dGVMZW5ndGgmMjU1LG8uc2V0KHQsMyksby5zZXQobiwzK3QuYnl0ZUxlbmd0aCksb30sam89KGUsbik9PntsZXQgdD1kZShlKSxvPW5ldyBVaW50OEFycmF5KDQrdC5ieXRlTGVuZ3RoKTtyZXR1cm4gb1swXT12cixvWzFdPU51bWJlcihuKSxvWzJdPXQuYnl0ZUxlbmd0aD4+PjgmMjU1LG9bM109dC5ieXRlTGVuZ3RoJjI1NSxvLnNldCh0LDQpLG99LHFvPWU9PntsZXQgbj1uZXcgVWludDhBcnJheShlKTtpZihuLmJ5dGVMZW5ndGg8MylyZXR1cm4gbnVsbDtpZihuWzBdPT09a3Ipe2xldCBpPShuWzFdPz8wKTw8OHwoblsyXT8/MCkscz0zK2k7cmV0dXJuIGk8PTB8fG4uYnl0ZUxlbmd0aDxzP251bGw6e3R5cGU6InJvb20iLHJvb21Ub2tlbjpnZShuLnN1YmFycmF5KDMscykpLHBheWxvYWQ6bi5zdWJhcnJheShzKS5zbGljZSgpLmJ1ZmZlcn19aWYoblswXSE9PXZyfHxuLmJ5dGVMZW5ndGg8NClyZXR1cm4gbnVsbDtsZXQgdD0oblsyXT8/MCk8PDh8KG5bM10/PzApLG89NCt0O3JldHVybiB0PD0wfHxuLmJ5dGVMZW5ndGg8bz9udWxsOnt0eXBlOiJwcmVzZW5jZSIscm9vbVRva2VuOmdlKG4uc3ViYXJyYXkoNCxvKSksaXNQcmVzZW50Om5bMV09PT0xfX0sU3I9ZT0+e2xldHtjb25uZWN0aW9uOm4sY2hhbm5lbDp0fT1lO3JldHVybiBlLmlzRGVhZHx8bi5jb25uZWN0aW9uU3RhdGU9PT0iY2xvc2VkInx8bi5jb25uZWN0aW9uU3RhdGU9PT0iZmFpbGVkInx8bi5pY2VDb25uZWN0aW9uU3RhdGU9PT0iY2xvc2VkInx8bi5pY2VDb25uZWN0aW9uU3RhdGU9PT0iZmFpbGVkInx8dD8ucmVhZHlTdGF0ZT09PSJjbG9zaW5nInx8dD8ucmVhZHlTdGF0ZT09PSJjbG9zZWQifSxicj1lPT57aWYoU3IoZSkpcmV0dXJuInN0YWxlIjtsZXR7Y2hhbm5lbDpufT1lO3JldHVybiFufHxuLnJlYWR5U3RhdGUhPT0ib3BlbiI/InRyYW5zaWVudCI6ImxpdmUifSxUcj1jbGFzc3tieUFwcD17fTtyb29tUHJlc2VuY2VIYW5kbGVycz17fTtnZXRNYXAoZSl7cmV0dXJuIHRoaXMuYnlBcHBbZV0/Pz17fX1nZXQoZSxuKXtyZXR1cm4gdGhpcy5ieUFwcFtlXT8uW25dfWlzUGVlclN0YWxlKGUpe3JldHVybiBTcihlKX1nZXRIZWFsdGgoZSl7cmV0dXJuIHRoaXMuaXNQZWVyU3RhbGUoZSk/InN0YWxlIjoibGl2ZSJ9c2V0Um9vbVByZXNlbmNlSGFuZGxlcihlLG4pe3JldHVybiB0aGlzLnJvb21QcmVzZW5jZUhhbmRsZXJzW2VdPW4sKCk9Pnt0aGlzLnJvb21QcmVzZW5jZUhhbmRsZXJzW2VdPT09biYmZGVsZXRlIHRoaXMucm9vbVByZXNlbmNlSGFuZGxlcnNbZV19fXNlbmRSb29tUHJlc2VuY2UoZSxuLHQpe2UuaXNDbG9zaW5nfHxlLnBlZXIuaXNEZWFkfHxlLnBlZXIuc2VuZERhdGEoam8obix0KSl9Y2xlYXIoZSxuLHtkZXN0cm95UGVlcjp0fSl7bGV0IG89dGhpcy5ieUFwcFtlXSxpPW8/LltuXTtpZighaXx8aS5pc0Nsb3NpbmcpcmV0dXJuO2kuaWRsZVRpbWVyPV8oaS5pZGxlVGltZXIpLGkuaXNDbG9zaW5nPSEwLHQmJiFpLnBlZXIuaXNEZWFkJiZpLnBlZXIuZGVzdHJveSgpO2xldCBzPXdlKGkuYmluZGluZ3MpO2kuYmluZGluZ3M9e30saS5iaW5kaW5nc0J5VG9rZW49e30saS5jb250cm9sUm9vbUlkPW51bGwsZGVsZXRlIG9bbl0scy5mb3JFYWNoKHI9PntyLmhhbmRsZXJzLmNsb3NlPy4oKSxyLnBlbmRpbmdEYXRhLmxlbmd0aD0wLHIucGVuZGluZ1NlbmREYXRhLmxlbmd0aD0wLHIucGVuZGluZ1RyYWNrcy5sZW5ndGg9MH0pLGkubWVkaWEuY2xlYXJSZW1vdGUoKSxpLnBlbmRpbmdEYXRhQnlUb2tlbi5jbGVhcigpLGkucmVtb3RlUm9vbVRva2Vucy5jbGVhcigpLFEobykubGVuZ3RoPT09MCYmZGVsZXRlIHRoaXMuYnlBcHBbZV19cmVnaXN0ZXIoZSxuLHQsbyl7bGV0IGk9dGhpcy5nZXRNYXAoZSkscz1pW25dO2lmKHMpe2lmKHMuaWRsZVRpbWVyPV8ocy5pZGxlVGltZXIpLHMucGVlcj09PXQpcmV0dXJuIHM7dGhpcy5jbGVhcihlLG4se2Rlc3Ryb3lQZWVyOiEwfSl9bGV0IHI9e2FwcElkOmUscGVlcklkOm4scGVlcjp0LGJpbmRpbmdzOnt9LGJpbmRpbmdzQnlUb2tlbjp7fSxwZW5kaW5nRGF0YUJ5VG9rZW46bmV3IE1hcCxyZW1vdGVSb29tVG9rZW5zOm5ldyBTZXQsaWRsZVRpbWVyOm51bGwsY29udHJvbFJvb21JZDpudWxsLHN0cmVhbU93bmVyczpuZXcgTWFwLHRyYWNrT3duZXJzOm5ldyBNYXAsbWVkaWE6R24oKSxpZGxlTXM6byxpc0Nsb3Npbmc6ITF9O3JldHVybiB0LnNldEhhbmRsZXJzKHtkYXRhOmE9PnRoaXMuZGlzcGF0Y2hEYXRhKHIsYSksc2lnbmFsOmE9PnRoaXMuZGlzcGF0Y2hTaWduYWwocixhKSxjbG9zZTooKT0+dGhpcy5jbGVhcihlLG4se2Rlc3Ryb3lQZWVyOiExfSksZXJyb3I6YT0+e2NvbnNvbGUuZXJyb3IoYCR7R30gcGVlciBlcnJvcjpgLGEpLHRoaXMuY2xlYXIoZSxuLHtkZXN0cm95UGVlcjohMX0pfSx0cmFjazooYSxjKT0+dGhpcy5kaXNwYXRjaFRyYWNrKHIsYSxjKX0pLGlbbl09cixyfWJpbmQoZSxuLHQse29uRGV0YWNoOm99KXtsZXQgaT10LmJpbmRpbmdzW2VdO2lmKGkpcmV0dXJuIHQuaWRsZVRpbWVyPV8odC5pZGxlVGltZXIpLHtwcm94eTppLnByb3h5LGlzTmV3OiExfTtsZXQgcz17cm9vbUlkOmUscm9vbVRva2VuOm51bGwscm9vbVRva2VuUHJvbWlzZTpuLGhhbmRsZXJzOnt9LHBlbmRpbmdEYXRhOltdLHBlbmRpbmdTZW5kRGF0YTpbXSxwZW5kaW5nVHJhY2tzOltdLGRldGFjaDpWLHByb3h5Ont9fSxyPSgpPT57dC5iaW5kaW5nc1tlXSYmKHRoaXMucHJ1bmVSb29tT3duZXJzaGlwKHQsZSksZGVsZXRlIHQuYmluZGluZ3NbZV0scy5yb29tVG9rZW4mJnQuYmluZGluZ3NCeVRva2VuW3Mucm9vbVRva2VuXT09PXMmJmRlbGV0ZSB0LmJpbmRpbmdzQnlUb2tlbltzLnJvb21Ub2tlbl0sdC5jb250cm9sUm9vbUlkPT09ZSYmKHQuY29udHJvbFJvb21JZD1RKHQuYmluZGluZ3MpWzBdPz9udWxsKSxvKCksdGhpcy5zY2hlZHVsZUlkbGVUaW1lcih0KSl9LGE9e2NyZWF0ZWQ6dC5wZWVyLmNyZWF0ZWQsZ2V0IGNvbm5lY3Rpb24oKXtyZXR1cm4gdC5wZWVyLmNvbm5lY3Rpb259LGdldCBjaGFubmVsKCl7cmV0dXJuIHQucGVlci5jaGFubmVsfSxnZXQgaXNEZWFkKCl7cmV0dXJuIHQucGVlci5pc0RlYWR9LGdldE9mZmVyOmM9PnQucGVlci5nZXRPZmZlcihjKSxzaWduYWw6Yz0+dC5wZWVyLnNpZ25hbChjKSxzZW5kRGF0YTpjPT57aWYoIXMucm9vbVRva2VuKXtzLnBlbmRpbmdTZW5kRGF0YS5wdXNoKGMpO3JldHVybn10LnBlZXIuc2VuZERhdGEoUHIocy5yb29tVG9rZW4sYykpfSxkZXN0cm95OigpPT5yKCksc2V0SGFuZGxlcnM6Yz0+e2xldHtzaWduYWw6dSwuLi5sfT1jO09iamVjdC5hc3NpZ24ocy5oYW5kbGVycyxsKSx1JiYocy5oYW5kbGVycy5zaWduYWw9dSksdGhpcy5mbHVzaEJpbmRpbmdRdWV1ZXMocyl9LG9mZmVyUHJvbWlzZTp0LnBlZXIub2ZmZXJQcm9taXNlLGFkZFN0cmVhbTpjPT57bGV0IHU9dC5zdHJlYW1Pd25lcnMuZ2V0KGMpPz9uZXcgU2V0LGw9dS5zaXplPT09MDt1LmFkZChlKSx0LnN0cmVhbU93bmVycy5zZXQoYyx1KSxsJiZ0LnBlZXIuYWRkU3RyZWFtKGMpfSxyZW1vdmVTdHJlYW06Yz0+e2xldCB1PXQuc3RyZWFtT3duZXJzLmdldChjKTt1JiYodS5kZWxldGUoZSksdS5zaXplPT09MCYmKHQuc3RyZWFtT3duZXJzLmRlbGV0ZShjKSx0LnBlZXIucmVtb3ZlU3RyZWFtKGMpKSl9LGFkZFRyYWNrOihjLHUpPT57bGV0IGw9dC50cmFja093bmVycy5nZXQoYyk/P3tzdHJlYW06dSxyb29tczpuZXcgU2V0fSxmPWwucm9vbXMuc2l6ZT09PTA7cmV0dXJuIGwuc3RyZWFtPXUsbC5yb29tcy5hZGQoZSksdC50cmFja093bmVycy5zZXQoYyxsKSxmP3QucGVlci5hZGRUcmFjayhjLHUpOnQucGVlci5jb25uZWN0aW9uLmdldFNlbmRlcnMoKS5maW5kKGQ9PmQudHJhY2s9PT1jKT8/dC5wZWVyLmFkZFRyYWNrKGMsdSl9LHJlbW92ZVRyYWNrOmM9PntsZXQgdT10LnRyYWNrT3duZXJzLmdldChjKTt1JiYodS5yb29tcy5kZWxldGUoZSksdS5yb29tcy5zaXplPT09MCYmKHQudHJhY2tPd25lcnMuZGVsZXRlKGMpLHQucGVlci5yZW1vdmVUcmFjayhjKSkpfSxyZXBsYWNlVHJhY2s6KGMsdSk9PntsZXQgbD10LnRyYWNrT3duZXJzLmdldChjKTtpZihsKXt0LnRyYWNrT3duZXJzLmRlbGV0ZShjKTtsZXQgZj10LnRyYWNrT3duZXJzLmdldCh1KT8/e3N0cmVhbTpsLnN0cmVhbSxyb29tczpuZXcgU2V0fTtsLnJvb21zLmZvckVhY2goZD0+Zi5yb29tcy5hZGQoZCkpLHQudHJhY2tPd25lcnMuc2V0KHUsZil9cmV0dXJuIHQucGVlci5yZXBsYWNlVHJhY2soYyx1KX0sX190cnlzdGVyb01lZGlhOnQubWVkaWF9O3JldHVybiBzLnByb3h5PWEscy5kZXRhY2g9cix0LmJpbmRpbmdzW2VdPXMsdC5jb250cm9sUm9vbUlkPz89ZSx0LmlkbGVUaW1lcj1fKHQuaWRsZVRpbWVyKSxuLnRoZW4oYz0+e2lmKHQuaXNDbG9zaW5nfHx0LmJpbmRpbmdzW2VdIT09cylyZXR1cm47cy5yb29tVG9rZW49Yyx0LmJpbmRpbmdzQnlUb2tlbltjXT1zO2xldCB1PXQucGVuZGluZ0RhdGFCeVRva2VuLmdldChjKTt1Py5sZW5ndGgmJihzLnBlbmRpbmdEYXRhLnB1c2goLi4udSksdC5wZW5kaW5nRGF0YUJ5VG9rZW4uZGVsZXRlKGMpKSxzLnBlbmRpbmdTZW5kRGF0YS5zcGxpY2UoMCkuZm9yRWFjaChsPT50LnBlZXIuc2VuZERhdGEoUHIoYyxsKSkpLHRoaXMuZmx1c2hCaW5kaW5nUXVldWVzKHMpfSkse3Byb3h5OmEsaXNOZXc6ITB9fXBydW5lUm9vbU93bmVyc2hpcChlLG4pe2Uuc3RyZWFtT3duZXJzLmZvckVhY2goKHQsbyk9Pnt0LmRlbGV0ZShuKSx0LnNpemU9PT0wJiYoZS5zdHJlYW1Pd25lcnMuZGVsZXRlKG8pLGUucGVlci5yZW1vdmVTdHJlYW0obykpfSksZS50cmFja093bmVycy5mb3JFYWNoKCh0LG8pPT57dC5yb29tcy5kZWxldGUobiksdC5yb29tcy5zaXplPT09MCYmKGUudHJhY2tPd25lcnMuZGVsZXRlKG8pLGUucGVlci5yZW1vdmVUcmFjayhvKSl9KX1zY2hlZHVsZUlkbGVUaW1lcihlKXtlLmlzQ2xvc2luZ3x8UShlLmJpbmRpbmdzKS5sZW5ndGg+MHx8KGUuaWRsZVRpbWVyPV8oZS5pZGxlVGltZXIpLGUuaWRsZVRpbWVyPXNldFRpbWVvdXQoKCk9PntsZXQgbj10aGlzLmJ5QXBwW2UuYXBwSWRdPy5bZS5wZWVySWRdOyFufHxRKG4uYmluZGluZ3MpLmxlbmd0aD4wfHx0aGlzLmNsZWFyKGUuYXBwSWQsZS5wZWVySWQse2Rlc3Ryb3lQZWVyOiEwfSl9LGUuaWRsZU1zKSl9Z2V0U2lnbmFsQmluZGluZyhlKXtpZihlLmNvbnRyb2xSb29tSWQpe2xldCB0PWUuYmluZGluZ3NbZS5jb250cm9sUm9vbUlkXTtpZih0Py5oYW5kbGVycy5zaWduYWwpcmV0dXJuIHR9bGV0IG49d2UoZS5iaW5kaW5ncykuZmluZCh0PT4hIXQuaGFuZGxlcnMuc2lnbmFsKTtyZXR1cm4gbj8oZS5jb250cm9sUm9vbUlkPW4ucm9vbUlkLG4pOm51bGx9Zmx1c2hCaW5kaW5nUXVldWVzKGUpe2xldHtoYW5kbGVyczpufT1lO24uZGF0YSYmZS5wZW5kaW5nRGF0YS5sZW5ndGg+MCYmZS5wZW5kaW5nRGF0YS5zcGxpY2UoMCkuZm9yRWFjaCh0PT5uLmRhdGE/Lih0KSksKG4udHJhY2t8fG4uc3RyZWFtKSYmZS5wZW5kaW5nVHJhY2tzLmxlbmd0aCYmZS5wZW5kaW5nVHJhY2tzLnNwbGljZSgwKS5mb3JFYWNoKCh7dHJhY2s6dCxzdHJlYW06b30pPT57bi50cmFjaz8uKHQsbyksbi5zdHJlYW0/LihvKX0pfWRpc3BhdGNoRGF0YShlLG4pe2xldCB0PXFvKG4pO2lmKCF0KXJldHVybjtpZih0LnR5cGU9PT0icHJlc2VuY2UiKXt0LmlzUHJlc2VudD9lLnJlbW90ZVJvb21Ub2tlbnMuYWRkKHQucm9vbVRva2VuKTplLnJlbW90ZVJvb21Ub2tlbnMuZGVsZXRlKHQucm9vbVRva2VuKSx0aGlzLnJvb21QcmVzZW5jZUhhbmRsZXJzW2UuYXBwSWRdPy4oZS5wZWVySWQsdC5yb29tVG9rZW4sdC5pc1ByZXNlbnQpO3JldHVybn1sZXQgbz1lLmJpbmRpbmdzQnlUb2tlblt0LnJvb21Ub2tlbl07aWYoIW8pe2xldCBpPWUucGVuZGluZ0RhdGFCeVRva2VuLmdldCh0LnJvb21Ub2tlbik/P1tdO2kucHVzaCh0LnBheWxvYWQpLGUucGVuZGluZ0RhdGFCeVRva2VuLnNldCh0LnJvb21Ub2tlbixpKTtyZXR1cm59by5oYW5kbGVycy5kYXRhP28uaGFuZGxlcnMuZGF0YSh0LnBheWxvYWQpOm8ucGVuZGluZ0RhdGEucHVzaCh0LnBheWxvYWQpfWRpc3BhdGNoU2lnbmFsKGUsbil7dGhpcy5nZXRTaWduYWxCaW5kaW5nKGUpPy5oYW5kbGVycy5zaWduYWw/LihuKX1kaXNwYXRjaFRyYWNrKGUsbix0KXt3ZShlLmJpbmRpbmdzKS5mb3JFYWNoKG89PntpZihvLmhhbmRsZXJzLnRyYWNrfHxvLmhhbmRsZXJzLnN0cmVhbSl7by5oYW5kbGVycy50cmFjaz8uKG4sdCksby5oYW5kbGVycy5zdHJlYW0/Lih0KTtyZXR1cm59by5wZW5kaW5nVHJhY2tzLnB1c2goe3RyYWNrOm4sc3RyZWFtOnR9KX0pfX07dmFyICRvPTIzMzMzLFdvPTEyLEZvPTc1MzMsem89MjMzMzMsWm49Il9fbGVnYWN5X18iLGRuPSJvZmZlci1wbGFjZWhvbGRlciIsSm89WyJvZmZlciIsImFuc3dlciIsImNhbmRpZGF0ZSJdLFZvPWU9PntpZih0eXBlb2YgZT09InN0cmluZyIpdHJ5e2xldCBuPWhlKGUpO3JldHVybiBuJiZ0eXBlb2Ygbj09Im9iamVjdCI/bjpudWxsfWNhdGNoe3JldHVybiBudWxsfXJldHVybiBlJiZ0eXBlb2YgZT09Im9iamVjdCI/ZTpudWxsfSxZZT0oZSxuKT0+dHlwZW9mIGVbbl09PSJzdHJpbmciJiZlW25dP2Vbbl06dm9pZCAwLEdvPWU9PkpvLnNvbWUobj0+biBpbiBlJiYodHlwZW9mIGVbbl0hPSJzdHJpbmcifHxlW25dPT09IiIpKSxBcj0oZSxuLHQsbyxpLHMpPT57ZS50b0NpcGhlcihuKS50aGVuKHI9PntlLmlzTGVhdmluZygpfHwhcygpfHxvKHQsWihpKHIuc2RwKSkpfSl9LFpvPSgpPT4oe3N0YXR1czoiaWRsZSIsb2ZmZXJQZWVyOm51bGwsb2ZmZXJJZDpudWxsLG9mZmVyU2RwOm51bGwsb2ZmZXJJbml0UHJvbWlzZTpudWxsLG9mZmVyQW5zd2VyZWQ6ITEsb2ZmZXJSZWxheXM6W10sb2ZmZXJTaWduYWxSZWxheXM6W10sb2ZmZXJTaWduYWxCYWNrbG9nOltdLG9mZmVyUmVsYXlUaW1lcnM6W10sb2ZmZXJFeHBpcnlUaW1lcjpudWxsLGNvbm5lY3RlZFBlZXI6bnVsbCxjb25uZWN0ZWRQZWVyVW5oZWFsdGh5U2luY2VNczpudWxsLGFuc3dlcmluZ0V4cGlyeVRpbWVyOm51bGwsYW5zd2VyaW5nUGVlcjpudWxsLGFuc3dlclNlbnQ6ITEsY29ubmVjdGlvbkVycm9yUmVwb3J0ZWQ6ITEscGVuZGluZ0NhbmRpZGF0ZXM6e319KSxYbz1lPT5bLi4uZS50dXJuQ29uZmlnPz9bXSwuLi5lLnJ0Y0NvbmZpZz8uaWNlU2VydmVycz8/W11dLnNvbWUoKHt1cmxzOm59KT0+KEFycmF5LmlzQXJyYXkobik/bjpbbl0pLnNvbWUodD0+L150dXJucz86L2kudGVzdCh0KSkpLFlvPShlLG4pPT5gY291bGQgbm90IGNvbm5lY3QgdG8gcGVlciAke2V9IGFmdGVyIGV4Y2hhbmdpbmcgU0RQOyAke1hvKG4pPyJjaGVjayB0aGF0IHlvdXIgVFVSTiBzZXJ2ZXIgVVJMcyBhbmQgY3JlZGVudGlhbHMgYXJlIHJlYWNoYWJsZSBieSBib3RoIHBlZXJzIjoiY29uZmlndXJlIFRVUk4gc2VydmVycyB3aXRoIHR1cm5Db25maWcgb3IgcnRjQ29uZmlnLmljZVNlcnZlcnMifWAsZ249KGUsbix0KT0+e2UuaXNMZWF2aW5nKCl8fG4uY29ubmVjdGVkUGVlcnx8bi5jb25uZWN0aW9uRXJyb3JSZXBvcnRlZHx8KG4uY29ubmVjdGlvbkVycm9yUmVwb3J0ZWQ9ITAsZS5vbkpvaW5FcnJvcj8uKHtlcnJvcjpZbyh0LGUuY29uZmlnKSxhcHBJZDplLmFwcElkLHBlZXJJZDp0LHJvb21JZDplLnJvb21JZH0pKX0samU9KGUsbik9PmVbbl0/Pz1abygpLGNlPWU9PntlLmNvbm5lY3RlZFBlZXI/ZS5zdGF0dXM9ImNvbm5lY3RlZCI6ZS5hbnN3ZXJpbmdQZWVyP2Uuc3RhdHVzPSJhbnN3ZXJpbmciOmUub2ZmZXJQZWVyfHxlLm9mZmVyUmVsYXlzLnNvbWUoQm9vbGVhbik/ZS5zdGF0dXM9Im9mZmVyaW5nIjplLnN0YXR1cz0iaWRsZSJ9LHVuPShlLG4pPT57ZS5hbnN3ZXJpbmdQZWVyPT09biYmKGUuYW5zd2VyaW5nRXhwaXJ5VGltZXI9XyhlLmFuc3dlcmluZ0V4cGlyeVRpbWVyKSxlLmFuc3dlcmluZ1BlZXI9bnVsbCxlLmFuc3dlclNlbnQ9ITEsY2UoZSkpfSxtbj0oZSxuLHQpPT57ZS5jb25uZWN0ZWRQZWVyJiYoZS5jb25uZWN0ZWRQZWVyLmlzRGVhZHx8ZS5jb25uZWN0ZWRQZWVyLmRlc3Ryb3koKSxlLmNvbm5lY3RlZFBlZXI9bnVsbCxlLmNvbm5lY3RlZFBlZXJVbmhlYWx0aHlTaW5jZU1zPW51bGwsY2UoZSkpfSxYbj0oZSxuKT0+e2Uub2ZmZXJSZWxheVRpbWVyc1tuXT1fKGUub2ZmZXJSZWxheVRpbWVyc1tuXSksZS5vZmZlclJlbGF5c1tuXSYmKGUub2ZmZXJSZWxheXNbbl09dm9pZCAwLGNlKGUpKX0sUnI9KGUsbik9PntlPy5vZmZlclJlbGF5c1tuXT09PWRuJiZYbihlLG4pfSxRbz1lPT57aWYoZS5pc0RlYWR8fGUuY29ubmVjdGlvbi5jb25uZWN0aW9uU3RhdGU9PT0iY2xvc2VkIilyZXR1cm4hMDt0cnl7cmV0dXJuISFlLmNvbm5lY3Rpb24ucmVtb3RlRGVzY3JpcHRpb259Y2F0Y2h7cmV0dXJuITB9fSxxZT0oZSxuKT0+e2xldCB0PWUub2ZmZXJBbnN3ZXJlZDtlLm9mZmVyRXhwaXJ5VGltZXI9XyhlLm9mZmVyRXhwaXJ5VGltZXIpLGUub2ZmZXJJbml0UHJvbWlzZT1udWxsLGUub2ZmZXJSZWxheXMuZm9yRWFjaCgobyxpKT0+WG4oZSxpKSksZS5vZmZlclJlbGF5cz1bXSxlLm9mZmVyU2lnbmFsUmVsYXlzPVtdLGUub2ZmZXJSZWxheVRpbWVycz1bXSxlLm9mZmVyU2lnbmFsQmFja2xvZz1bXSxlLm9mZmVyUGVlciYmZS5vZmZlclBlZXIhPT1lLmNvbm5lY3RlZFBlZXImJih0fHxRbyhlLm9mZmVyUGVlcik/ZS5vZmZlclBlZXIuaXNEZWFkfHxlLm9mZmVyUGVlci5kZXN0cm95KCk6bi5yZWN5Y2xlKGUub2ZmZXJQZWVyKSksZS5vZmZlclBlZXI9bnVsbCxlLm9mZmVySWQ9bnVsbCxlLm9mZmVyU2RwPW51bGwsZS5vZmZlckFuc3dlcmVkPSExLGUuY29ubmVjdGlvbkVycm9yUmVwb3J0ZWQ9ITEsY2UoZSl9LGVzPShlLG4sdCxvKT0+e18obi5hbnN3ZXJpbmdFeHBpcnlUaW1lciksbi5hbnN3ZXJpbmdFeHBpcnlUaW1lcj1zZXRUaW1lb3V0KCgpPT57bGV0IGk9ZS5wZWVyU3RhdGVzW3RdOyFpfHxpLmNvbm5lY3RlZFBlZXJ8fGkuYW5zd2VyaW5nUGVlciE9PW98fChpLmFuc3dlclNlbnQmJmduKGUsaSx0KSxvLmRlc3Ryb3koKSx1bihpLG8pLGUuY2hlY2tEZWFjdGl2YXRlKCkpfSx6byl9LG5zPWFzeW5jKGUsbix0KT0+e2xldCBvPXQ/W3QsWm5dOltabl07Zm9yKGxldCBpIG9mIG8pe2xldCBzPWUucGVuZGluZ0NhbmRpZGF0ZXNbaV07aWYocz8ubGVuZ3RoKXtkZWxldGUgZS5wZW5kaW5nQ2FuZGlkYXRlc1tpXTtmb3IobGV0IHIgb2Ygcylhd2FpdCBuLnNpZ25hbChyKX19fSxFcj0oZSxuLHQsbz1WZSk9PntfKG4ub2ZmZXJFeHBpcnlUaW1lcik7bGV0IGk9bi5vZmZlcklkO24ub2ZmZXJFeHBpcnlUaW1lcj1zZXRUaW1lb3V0KCgpPT57bGV0IHM9ZS5wZWVyU3RhdGVzW3RdOyFzfHxzLmNvbm5lY3RlZFBlZXJ8fHMub2ZmZXJJZCE9PWl8fChzLm9mZmVyQW5zd2VyZWQmJmduKGUscyx0KSxxZShzLGUub2ZmZXJQb29sKSxlLmNoZWNrRGVhY3RpdmF0ZSgpKX0sbyl9LHRzPShlLG4sdCxvKT0+bi5vZmZlclBlZXImJm4ub2ZmZXJJZCYmbi5vZmZlclNkcD9Qcm9taXNlLnJlc29sdmUoe3BlZXI6bi5vZmZlclBlZXIsb2ZmZXI6bi5vZmZlclNkcCxvZmZlcklkOm4ub2ZmZXJJZH0pOihuLm9mZmVySW5pdFByb21pc2V8fChuLm9mZmVySW5pdFByb21pc2U9KGFzeW5jKCk9PntsZXQgaT0oYXdhaXQgZS5vZmZlclBvb2wuY2hlY2tvdXQoMSwhMSxlLmVuY3J5cHRPZmZlcikpWzBdO2lmKCFpKXRocm93IEkoImZhaWxlZCB0byBhbGxvY2F0ZSBvZmZlciBwZWVyIik7bGV0e3BlZXI6cyxvZmZlcjpyfT1pO24ub2ZmZXJQZWVyPXMsbi5vZmZlcklkPWxlKFdvKSxuLm9mZmVyU2RwPXIsbi5vZmZlckFuc3dlcmVkPSExLG4uY29ubmVjdGlvbkVycm9yUmVwb3J0ZWQ9ITEsbi5vZmZlclNpZ25hbEJhY2tsb2c9W10sY2Uobik7bGV0IGE9KCk9PntuLm9mZmVyUGVlcj09PXMmJiFuLmNvbm5lY3RlZFBlZXImJihuLm9mZmVyQW5zd2VyZWQmJmduKGUsbix0KSxxZShuLGUub2ZmZXJQb29sKSksZS5kaXNjb25uZWN0UGVlcihzLHQpLGUuY2hlY2tEZWFjdGl2YXRlKCl9O3JldHVybiBzLnNldEhhbmRsZXJzKHtjb25uZWN0OigpPT5lLmNvbm5lY3RQZWVyKHMsdCxvKSxzaWduYWw6Yz0+e24ub2ZmZXJQZWVyPT09cyYmKG4ub2ZmZXJTaWduYWxCYWNrbG9nLnB1c2goYyksbi5vZmZlclNpZ25hbFJlbGF5cy5mb3JFYWNoKHU9PnU/LihjKSkpfSxjbG9zZTphLGVycm9yOmF9KSxFcihlLG4sdCkse3BlZXI6cyxvZmZlcjpyLG9mZmVySWQ6bi5vZmZlcklkfX0pKCkuZmluYWxseSgoKT0+bi5vZmZlckluaXRQcm9taXNlPW51bGwpKSxuLm9mZmVySW5pdFByb21pc2UpLHJzPWFzeW5jKGUsbix0LG8saSk9PntpZihvKXtlLmF0dGFjaFNoYXJlZFBlZXJUb1Jvb20odCxvKTtyZXR1cm59bGV0IHM9ZS5wZWVyU3RhdGVzW3RdO2lmKCFzfHxzLmNvbm5lY3RlZFBlZXJ8fHMuYW5zd2VyaW5nUGVlcnx8cy5vZmZlckFuc3dlcmVkKXtScihzLG4pO3JldHVybn1pZihzLm9mZmVyUmVsYXlzW25dIT09ZG4pcmV0dXJuO2xldFtyLGFdPWF3YWl0IGFlKFtUZShEZShlLnJvb3RUb3BpY1BsYWludGV4dCx0KSksdHMoZSxzLHQsbildKTtpZihlLmlzTGVhdmluZygpKXJldHVybjtpZihzLmNvbm5lY3RlZFBlZXJ8fHMuYW5zd2VyaW5nUGVlcnx8cy5vZmZlckFuc3dlcmVkfHxzLm9mZmVyUmVsYXlzW25dIT09ZG4pe1JyKHMsbik7cmV0dXJufXMub2ZmZXJSZWxheVRpbWVyc1tuXT1fKHMub2ZmZXJSZWxheVRpbWVyc1tuXSkscy5vZmZlclJlbGF5c1tuXT0hMCxjZShzKSxzLm9mZmVyUmVsYXlUaW1lcnNbbl09c2V0VGltZW91dCgoKT0+aXMoZSx0LG4pLChlLmFubm91bmNlSW50ZXJ2YWxzW25dPz9lLmFubm91bmNlSW50ZXJ2YWxNcykqLjkpO2xldCBjPSExO3Mub2ZmZXJTaWduYWxSZWxheXNbbl09dT0+e2MmJihlLmlzTGVhdmluZygpfHxzLmNvbm5lY3RlZFBlZXJ8fHMub2ZmZXJQZWVyIT09YS5wZWVyfHxzLm9mZmVySWQhPT1hLm9mZmVySWR8fHUudHlwZSE9PSJjYW5kaWRhdGUifHxBcihlLHUscixpLGw9Pih7cGVlcklkOlksb2ZmZXJJZDphLm9mZmVySWQsY2FuZGlkYXRlOmwsLi4uZS5pc1Bhc3NpdmU/e3Bhc3NpdmU6ITB9Ont9fSksKCk9PiFzLmNvbm5lY3RlZFBlZXImJnMub2ZmZXJQZWVyPT09YS5wZWVyJiZzLm9mZmVySWQ9PT1hLm9mZmVySWQpKX0saShyLFooe3BlZXJJZDpZLG9mZmVySWQ6YS5vZmZlcklkLG9mZmVyOmEub2ZmZXIsLi4uZS5pc1Bhc3NpdmU/e3Bhc3NpdmU6ITB9Ont9fSkpLGM9ITAscy5vZmZlclNpZ25hbEJhY2tsb2cuZm9yRWFjaCh1PT5zLm9mZmVyU2lnbmFsUmVsYXlzW25dPy4odSkpfSxvcz1hc3luYyhlLG4sdCxvLGkscyxyKT0+e2xldCBhPWplKGUucGVlclN0YXRlcyx0KTtpZihhLmFuc3dlcmluZ1BlZXJ8fGEub2ZmZXJBbnN3ZXJlZClyZXR1cm47bGV0IGM9ISEoYS5vZmZlclBlZXJ8fGEub2ZmZXJSZWxheXMuc29tZShCb29sZWFuKSk7aWYoKGN8fHMpJiZZPHQpcmV0dXJuO2MmJnFlKGEsZS5vZmZlclBvb2wpO2xldCB1PWUuaW5pdFBlZXIoITEsZS5jb25maWcpO2EuYW5zd2VyaW5nUGVlcj11LGEuYW5zd2VyU2VudD0hMSxhLmNvbm5lY3Rpb25FcnJvclJlcG9ydGVkPSExLGVzKGUsYSx0LHUpLGNlKGEpO2xldCBsPSgpPT57YS5hbnN3ZXJpbmdQZWVyPT09dSYmIWEuY29ubmVjdGVkUGVlciYmYS5hbnN3ZXJTZW50JiZnbihlLGEsdCksdW4oYSx1KSxlLmRpc2Nvbm5lY3RQZWVyKHUsdCksZS5jaGVja0RlYWN0aXZhdGUoKX07dS5zZXRIYW5kbGVycyh7Y29ubmVjdDooKT0+ZS5jb25uZWN0UGVlcih1LHQsbiksY2xvc2U6bCxlcnJvcjpsfSk7bGV0IGY7dHJ5e2Y9YXdhaXQgZS50b1BsYWluKHt0eXBlOiJvZmZlciIsc2RwOm99KX1jYXRjaHt1bihhLHUpLGUub25Kb2luRXJyb3I/Lih7ZXJyb3I6ImluY29ycmVjdCByb29tIHBhc3N3b3JkIHdoZW4gZGVjcnlwdGluZyBvZmZlciIsYXBwSWQ6ZS5hcHBJZCxwZWVySWQ6dCxyb29tSWQ6ZS5yb29tSWR9KTtyZXR1cm59aWYodS5pc0RlYWQpe3VuKGEsdSk7cmV0dXJufWxldCBkPWF3YWl0IFRlKERlKGUucm9vdFRvcGljUGxhaW50ZXh0LHQpKTtlLmlzTGVhdmluZygpfHwodS5zZXRIYW5kbGVycyh7c2lnbmFsOmc9PntlLmlzTGVhdmluZygpfHxhLmFuc3dlcmluZ1BlZXIhPT11fHx1LmlzRGVhZHx8Zy50eXBlIT09ImFuc3dlciImJmcudHlwZSE9PSJjYW5kaWRhdGUifHxBcihlLGcsZCxyLHA9PntsZXQgUj17cGVlcklkOll9O3JldHVybiBnLnR5cGU9PT0iYW5zd2VyIj8oYS5hbnN3ZXJTZW50PSEwLFIuYW5zd2VyPXApOlIuY2FuZGlkYXRlPXAsaSYmKFIub2ZmZXJJZD1pKSxlLmlzUGFzc2l2ZSYmKFIucGFzc2l2ZT0hMCksUn0sKCk9PmEuYW5zd2VyaW5nUGVlcj09PXUmJiF1LmlzRGVhZCl9fSksYXdhaXQgdS5zaWduYWwoZiksYXdhaXQgbnMoYSx1LGkpKX0sc3M9YXN5bmMoZSxuLHQsbyxpKT0+e2xldCBzO3RyeXtzPWF3YWl0IGUudG9QbGFpbih7dHlwZTphbixzZHA6dH0pfWNhdGNoe3JldHVybn1sZXQgcj1qZShlLnBlZXJTdGF0ZXMsbiksYT1vJiZyPy5vZmZlclBlZXImJnIub2ZmZXJJZD09PW8/ci5vZmZlclBlZXI6bnVsbCxjPXI/LmFuc3dlcmluZ1BlZXI/P251bGwsdT0hbyYmcj8ub2ZmZXJQZWVyP3Iub2ZmZXJQZWVyOm51bGwsbD1pJiYhaS5pc0RlYWQ/aTphPz9jPz91O2lmKCFsfHxsLmlzRGVhZCl7bGV0IGY9bz8/Wm47KHIucGVuZGluZ0NhbmRpZGF0ZXNbZl0/Pz1bXSkucHVzaChzKTtyZXR1cm59bC5zaWduYWwocyl9LGFzPWFzeW5jKGUsbix0LG8saSxzKT0+e2xldCByO3RyeXtyPWF3YWl0IGUudG9QbGFpbih7dHlwZToiYW5zd2VyIixzZHA6b30pfWNhdGNoe2Uub25Kb2luRXJyb3I/Lih7ZXJyb3I6ImluY29ycmVjdCByb29tIHBhc3N3b3JkIHdoZW4gZGVjcnlwdGluZyBhbnN3ZXIiLGFwcElkOmUuYXBwSWQscGVlcklkOnQscm9vbUlkOmUucm9vbUlkfSk7cmV0dXJufWlmKHMpZS5vZmZlclBvb2wuY2xhaW1MZWFzZWQocykscy5zZXRIYW5kbGVycyh7Y29ubmVjdDooKT0+ZS5jb25uZWN0UGVlcihzLHQsbiksY2xvc2U6KCk9PmUuZGlzY29ubmVjdFBlZXIocyx0KX0pLHMuc2lnbmFsKHIpO2Vsc2V7bGV0IGE9ZS5wZWVyU3RhdGVzW3RdO2lmKCFhfHwhYS5vZmZlclBlZXJ8fGEub2ZmZXJBbnN3ZXJlZHx8aSYmYS5vZmZlcklkJiZpIT09YS5vZmZlcklkfHxhLm9mZmVyUGVlci5pc0RlYWQpcmV0dXJuO2Eub2ZmZXJBbnN3ZXJlZD0hMCxFcihlLGEsdCwkbyksYS5vZmZlclBlZXIuc2lnbmFsKHIpfX0saXM9KGUsbix0KT0+e2xldCBvPWUucGVlclN0YXRlc1tuXTshb3x8by5jb25uZWN0ZWRQZWVyfHxvLm9mZmVyUmVsYXlzW3RdJiYoWG4obyx0KSxlLmNoZWNrRGVhY3RpdmF0ZSgpKX0sTXI9ZT0+bj0+YXN5bmModCxvLGkpPT57aWYoZS5pc0xlYXZpbmcoKSlyZXR1cm47bGV0IHM9Vm8obyk7aWYoIXN8fEdvKHMpKXJldHVybjtsZXQgcj1ZZShzLCJwZWVySWQiKT8/IiIsYT1ZZShzLCJvZmZlciIpLGM9WWUocywiYW5zd2VyIiksdT1ZZShzLCJjYW5kaWRhdGUiKSxsPVllKHMsIm9mZmVySWQiKSxmPXMucGVlcixkPXMuaGFzT3V0Z29pbmdPZmZlcj09PSEwLGc9cy5wYXNzaXZlPT09ITA7aWYoIXJ8fHI9PT1ZKXJldHVybjtsZXRbcCxSXT1hd2FpdCBhZShbZS5yb290VG9waWNQLGUuc2VsZlRvcGljUF0pO2lmKGUuaXNMZWF2aW5nKCl8fHQhPT1wJiZ0IT09Unx8ZS5pc1Bhc3NpdmUmJmd8fChlLmlzUGFzc2l2ZSYmIWUuaXNBY3RpdmUmJiFjJiYhdSYmKGUuaXNBY3RpdmU9ITAsZS5yZXF1ZXVlQW5ub3VuY2U/LigpKSxlLmlzUGFzc2l2ZSYmIWUuaXNBY3RpdmUpKXJldHVybjtsZXQgYj1lLnBlZXJTdGF0ZXNbcl0sQj1iPy5jb25uZWN0ZWRQZWVyO2lmKEImJmIpe2xldCBIPWJyKEIpO2lmKEg9PT0ibGl2ZSIpe2IuY29ubmVjdGVkUGVlclVuaGVhbHRoeVNpbmNlTXM9bnVsbDtyZXR1cm59aWYoSD09PSJzdGFsZSIpbW4oYixyLCJtZXNzYWdlLWZyb20tc3RhbGUtcGVlciIpO2Vsc2V7bGV0IHY9RGF0ZS5ub3coKSxBPWIuY29ubmVjdGVkUGVlclVuaGVhbHRoeVNpbmNlTXM/P3Y7aWYoYi5jb25uZWN0ZWRQZWVyVW5oZWFsdGh5U2luY2VNcz1BLHYtQTxGbylyZXR1cm47bW4oYixyLCJtZXNzYWdlLWZyb20tcHJvbG9uZ2VkLWRpc2Nvbm5lY3QiKX19bGV0IHc9ZS5zaGFyZWRQZWVycy5nZXQoZS5hcHBJZCxyKTt3JiZlLnNoYXJlZFBlZXJzLmdldEhlYWx0aCh3LnBlZXIpPT09InN0YWxlIiYmKGUuc2hhcmVkUGVlcnMuY2xlYXIoZS5hcHBJZCxyLHtkZXN0cm95UGVlcjohMH0pLHc9dm9pZCAwKTtsZXQgQz0hIShyJiYhYSYmIWMmJiF1KTtpZihDJiYhdyl7bGV0IEg9amUoZS5wZWVyU3RhdGVzLHIpLHY9WTxyO2lmKEguYW5zd2VyaW5nUGVlcnx8SC5jb25uZWN0ZWRQZWVyfHxILm9mZmVyQW5zd2VyZWQpcmV0dXJuO2lmKCF2JiYhSC5vZmZlclBlZXIpe2xldCBBPWF3YWl0IFRlKERlKGUucm9vdFRvcGljUGxhaW50ZXh0LHIpKTshZS5pc0xlYXZpbmcoKSYmIUguY29ubmVjdGVkUGVlciYmaShBLFooe3BlZXJJZDpZfSkpO3JldHVybn1pZihILm9mZmVyUmVsYXlzW25dKXJldHVybjtILm9mZmVyUmVsYXlzW25dPWRuLGNlKEgpfWlmKHcmJihhfHxjfHx1KSl7aWYody5iaW5kaW5nc1tlLnJvb21JZF0pcmV0dXJuO2UuYXR0YWNoU2hhcmVkUGVlclRvUm9vbShyLHcpO3JldHVybn1pZihDKXJldHVybiBycyhlLG4scix3LGkpO2lmKGEpcmV0dXJuIG9zKGUsbixyLGEsbCxkLGkpO2lmKHUpcmV0dXJuIHNzKGUscix1LGwsZik7aWYoYylyZXR1cm4gYXMoZSxuLHIsYyxsLGYpfTt2YXIgaG49NTMzMyxjcz1bMjMzLDUzMywxMzMzXSxmcz03NTMzLGxzPTEyMzMzMyxZbj0oe2luaXQ6ZSxzdWJzY3JpYmU6bixhbm5vdW5jZTp0LGRlYWN0aXZhdGU6b30pPT57bGV0IGk9e30scz17fSxyPXt9LGE9e30sYz1uZXcgVHIsdT0oKT0+d2UoaSkuc29tZSh2PT5RKHYpLmxlbmd0aD4wKSxsPXY9PnNbdl0/Pz17fSxmPXY9PnJbdl0/Pz17fSxkPSh2LEEsSyk9PntjLmdldEhlYWx0aCh2LnBlZXIpPT09ImxpdmUiJiZjLnNlbmRSb29tUHJlc2VuY2UodixBLEspfSxnPSh2LEEpPT57bWUoc1t2XT8/e30pLmZvckVhY2goKFtLLFRdKT0+e2lmKCFULnNob3VsZEFkdmVydGlzZSgpKXJldHVybjtsZXR7cm9vbVRva2VuOiQscm9vbVRva2VuUHJvbWlzZTp6fT1UO2lmKCQpe2QoQSwkLCEwKTtyZXR1cm59ei50aGVuKGo9PntzW3ZdPy5bS109PT1UJiZULnJvb21Ub2tlbj09PWomJihjLmdldCh2LEEucGVlcklkKSE9PUF8fEEuaXNDbG9zaW5nfHxULnNob3VsZEFkdmVydGlzZSgpJiZkKEEsaiwhMCkpfSl9KX0scD0odixBLEspPT53ZShjLmdldE1hcCh2KSkuZm9yRWFjaChUPT5kKFQsQSxLKSksUj12PT57YVt2XXx8KGFbdl09Yy5zZXRSb29tUHJlc2VuY2VIYW5kbGVyKHYsKEEsSyxUKT0+e2lmKCFUKXJldHVybjtsZXQgJD1jLmdldCh2LEEpLHo9clt2XT8uW0tdOyEkfHwhenx8c1t2XT8uW3pdPy5hdHRhY2hTaGFyZWRQZWVyVG9Sb29tKEEsJCl9KSl9LGI9dj0+e2lbdl0mJlEoaVt2XSkubGVuZ3RoPjB8fChhW3ZdPy4oKSxkZWxldGUgYVt2XSxkZWxldGUgc1t2XSxkZWxldGUgclt2XSl9LEI9ITEsdz1bXSxDPW51bGwsSD1WO3JldHVybih2LEEsSyk9PntpZighdil0aHJvdyBJKCJyZXF1aXJlcyBhIGNvbmZpZyBtYXAgYXMgdGhlIGZpcnN0IGFyZ3VtZW50Iik7aWYoSyYmdHlwZW9mIEshPSJvYmplY3QiKXRocm93IEkoInRoaXJkIGFyZ3VtZW50IG11c3QgYmUgYSBjYWxsYmFja3Mgb2JqZWN0Iik7bGV0e2FwcElkOlR9PXYsJD1LPy5vbkpvaW5FcnJvcix6PUs/Lm9uUGVlckhhbmRzaGFrZSxqPUs/LmhhbmRzaGFrZVRpbWVvdXRNcztpZighVCl0aHJvdyBJKCJjb25maWcgbWFwIGlzIG1pc3NpbmcgYXBwSWQgZmllbGQiKTtpZighQSl0aHJvdyBJKCJyb29tSWQgYXJndW1lbnQgcmVxdWlyZWQiKTtpZihqIT09dm9pZCAwJiYoIU51bWJlci5pc0Zpbml0ZShqKXx8ajw9MCkpdGhyb3cgSSgiaGFuZHNoYWtlVGltZW91dE1zIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXIiKTtpZihpW1RdPy5bQV0pcmV0dXJuIGlbVF1bQV07UihUKTtsZXQgVz1EZShHLFQsQSksZWU9VGUoVyksbT1UZShEZShXLFkpKSx5PUd0KHYucGFzc3dvcmQ/PyIiLFQsQSksUz1adChULEEpLFA9di5fdGVzdF9vbmx5X3NoYXJlZFBlZXJJZGxlTXM/P2xzLE09ITEsTj1PPT5hc3luYyBEPT4oe3R5cGU6RC50eXBlLHNkcDphd2FpdCBPKHksRC5zZHApfSkscT1OKGVyKSxoPU4oUXQpLGs9Yy5nZXRNYXAoVCkseD0oKT0+V24oITAsdiksbmU9ITE7Q3x8PW5ldyBucih4KTtsZXQgdGU9QywkZT1hc3luYyBPPT57bGV0IEQ9YXdhaXQgTy5nZXRPZmZlcihEYXRlLm5vdygpLU8uY3JlYXRlZD5WZSk7aWYoIUR8fEQudHlwZSE9PSJvZmZlciIpdGhyb3cgSSgiZmFpbGVkIHRvIGdldCBvZmZlciBmb3IgcGVlciIpO3JldHVybihhd2FpdCBoKEQpKS5zZHB9LFdlPShPLEQpPT57bGV0IEw9amUoSi5wZWVyU3RhdGVzLE8pO0wuYW5zd2VyaW5nRXhwaXJ5VGltZXI9XyhMLmFuc3dlcmluZ0V4cGlyeVRpbWVyKSxMLmFuc3dlcmluZ1BlZXI9bnVsbDtsZXR7cHJveHk6WCxpc05ldzpVfT1jLmJpbmQoQSxTLEQse29uRGV0YWNoOigpPT57bGV0IG9lPUoucGVlclN0YXRlc1tPXTtvZT8uY29ubmVjdGVkUGVlcj09PUQucGVlciYmKG9lLmNvbm5lY3RlZFBlZXI9bnVsbCxvZS5jb25uZWN0ZWRQZWVyVW5oZWFsdGh5U2luY2VNcz1udWxsLGNlKG9lKSl9fSk7TC5jb25uZWN0ZWRQZWVyPUQucGVlcixMLmNvbm5lY3RlZFBlZXJVbmhlYWx0aHlTaW5jZU1zPW51bGwsY2UoTCksVSYmdm4oWCxPKSxxZShMLHRlKX0sVXI9KE8sRCxMKT0+e2lmKE0pe08uZGVzdHJveSgpO3JldHVybn1sZXQgWD1qZShKLnBlZXJTdGF0ZXMsRCk7aWYoWC5jb25uZWN0ZWRQZWVyKXtsZXQgc2U9a1tEXTtpZihzZSYmWC5jb25uZWN0ZWRQZWVyPT09c2UucGVlciYmc2UuYmluZGluZ3NbQV0pcmV0dXJuO1guY29ubmVjdGVkUGVlciE9PU8mJiFPLmlzRGVhZCYmTy5kZXN0cm95KCk7cmV0dXJufWxldCBVPWtbRF07aWYoVSYmYy5nZXRIZWFsdGgoVS5wZWVyKT09PSJzdGFsZSImJihjLmNsZWFyKFQsRCx7ZGVzdHJveVBlZXI6ITB9KSxVPXZvaWQgMCksVSYmVS5wZWVyIT09Tyl7Ty5pc0RlYWR8fE8uZGVzdHJveSgpLFdlKEQsVSk7cmV0dXJufWxldCBvZT0hVTtVfHw9Yy5yZWdpc3RlcihULEQsTyxQKSxXZShELFUpLG9lJiZnKFQsVSl9LEtyPShPLEQpPT57aWYoTSlyZXR1cm47bGV0IEw9Si5wZWVyU3RhdGVzW0RdO0w/LmNvbm5lY3RlZFBlZXI9PT1PJiYobW4oTCxELCJjbG9zZS1ldmVudCIpLGVuKCksIWllJiZuZSYmSi5yZXF1ZXVlQW5ub3VuY2U/LigpKX0saWU9ISF2LnBhc3NpdmUsQWU9bnVsbCxFZSxpdD1WLGVuPSgpPT57aWYoIWllfHwhSi5pc0FjdGl2ZSlyZXR1cm47bGV0IE89ITE7bWUoSi5wZWVyU3RhdGVzKS5mb3JFYWNoKChbRCxMXSk9PntMLmNvbm5lY3RlZFBlZXJ8fEwuYW5zd2VyaW5nUGVlcnx8TC5vZmZlckluaXRQcm9taXNlfHxMLm9mZmVyUGVlcnx8TC5vZmZlclJlbGF5cy5zb21lKEJvb2xlYW4pP089ITA6TC5zdGF0dXM9PT0iaWRsZSImJmRlbGV0ZSBKLnBlZXJTdGF0ZXNbRF19KSxPfHwoSi5pc0FjdGl2ZT0hMSxFZT1fKEVlKSxJZS5mb3JFYWNoKF8pLEllLmxlbmd0aD0wLGl0KCksQWU/LnJvb21Ub2tlbiYmcChULEFlLnJvb21Ub2tlbiwhMSkpfSxKPXthcHBJZDpULHJvb21JZDpBLGNvbmZpZzp2LHBlZXJTdGF0ZXM6e30scm9vdFRvcGljUGxhaW50ZXh0Olcscm9vdFRvcGljUDplZSxzZWxmVG9waWNQOm0sdG9QbGFpbjpxLHRvQ2lwaGVyOmgsaXNMZWF2aW5nOigpPT5NLGlzUGFzc2l2ZTppZSxpc0FjdGl2ZTohaWUsb25Kb2luRXJyb3I6JCxzaGFyZWRQZWVyczpjLG9mZmVyUG9vbDp0ZSxlbmNyeXB0T2ZmZXI6JGUsaW5pdFBlZXI6V24sY29ubmVjdFBlZXI6VXIsZGlzY29ubmVjdFBlZXI6S3IsYXR0YWNoU2hhcmVkUGVlclRvUm9vbTpXZSxjaGVja0RlYWN0aXZhdGU6ZW4sYW5ub3VuY2VJbnRlcnZhbHM6W10sYW5ub3VuY2VJbnRlcnZhbE1zOmhufSx5bj17Y29uZmlnOnYsYXBwSWQ6VCxyb29tSWQ6QSxpc1Bhc3NpdmU6aWV9LGpyPU1yKEopO2lmKCFCKXtsZXQgTz1lKHYpO3c9KEFycmF5LmlzQXJyYXkoTyk/TzpbT10pLm1hcChEPT5Qcm9taXNlLnJlc29sdmUoRCkpLEI9ITAsSD12LnJlbGF5Q29uZmlnPy5tYW51YWxSZWNvbm5lY3Rpb24/VjpWdCgpfSFpZSYmIXRlLmlzQWN0aXZlJiZ0ZS53YXJtdXAoKSxKLmFubm91bmNlSW50ZXJ2YWxzPXcubWFwKCgpPT5obik7bGV0IHduPXcubWFwKCgpPT5obiksUG49dy5tYXAoKCk9PjApLGtuPXcubWFwKCgpPT4wKSxJZT1bXSxjdD13Lm1hcChhc3luYyhPLEQpPT5uKGF3YWl0IE8sYXdhaXQgZWUsYXdhaXQgbSxqcihEKSxMPT50ZS5nZXRPZmZlcnMoTCwkZSkseW4pKTthZShbZWUsbV0pLnRoZW4oKFtPLERdKT0+e2lmKE0pcmV0dXJuO2xldCBMPWFzeW5jKFgsVSk9PntpZihNfHxpZSYmIUouaXNBY3RpdmUpcmV0dXJuO2xldCBvZT1pZT97cGFzc2l2ZTohMH06dm9pZCAwLHNlO3RyeXtzZT1hd2FpdCB0KFgsTyxELG9lLHluKSxrbltVXT0wfWNhdGNoKHpyKXtsZXQgbXQ9a25bVV0/PzA7bXQ9PT0wJiZ2LnJlbGF5Q29uZmlnPy53YXJuT25SZWxheUZhaWx1cmUhPT0hMSYmY29uc29sZS53YXJuKGAke0d9OiBhbm5vdW5jZSBmYWlsZWQgLSAke1BlKHpyLCIiKX1gKSxrbltVXT1tdCsxfWlmKE18fGllJiYhSi5pc0FjdGl2ZXx8c2UmJnR5cGVvZiBzZSE9Im51bWJlciImJiJzdG9wQW5ub3VuY2luZyJpbiBzZSlyZXR1cm47dHlwZW9mIHNlPT0ibnVtYmVyIj8oSi5hbm5vdW5jZUludGVydmFsc1tVXT1zZSx3bltVXT1zZSk6c2UmJih3bltVXT1zZS5uZXh0QW5ub3VuY2VNcyxuZXx8PXNlLnJlYW5ub3VuY2VPbkRpc2Nvbm5lY3Q9PT0hMCk7bGV0IGx0PVBuW1VdPz8wO1BuW1VdPWx0KzE7bGV0IHV0PXduW1VdPz9obixkdD1jc1tsdF07SWVbVV09c2V0VGltZW91dCgoKT0+e0woWCxVKX0sdHlwZW9mIGR0PT0ibnVtYmVyIj9NYXRoLm1pbih1dCxkdCk6dXQpfTtpdD0oKT0+e28mJncuZm9yRWFjaChhc3luYyBYPT57bGV0IFU9YXdhaXQgWDtNfHxvKFUsTyxELHluKX0pfSxKLnJlcXVldWVBbm5vdW5jZT0oKT0+e0llLmZvckVhY2goXyksSWUubGVuZ3RoPTAsRWU9XyhFZSksdGUuaXNBY3RpdmV8fHRlLndhcm11cCgpLEFlPy5yb29tVG9rZW4mJnAoVCxBZS5yb29tVG9rZW4sITApLEVlPXNldFRpbWVvdXQoZW4sZnMpLHcuZm9yRWFjaChhc3luYyhYLFUpPT57bGV0IG9lPWF3YWl0IFg7b2UmJiFNJiYoUG5bVV09MCxMKG9lLFUpKX0pfSxjdC5mb3JFYWNoKGFzeW5jKFgsVSk9PntpZihhd2FpdCBYLE0pcmV0dXJuO2xldCBvZT1hd2FpdCB3W1VdO29lJiYhTSYmKCFpZXx8Si5pc0FjdGl2ZSkmJkwob2UsVSl9KX0pO2xldCB2bj1WLHtjb21wb3NlOnFyfT10cih2LnBhc3N3b3JkPz8iIixULEEpLGZ0PXFyKHopLCRyPXsuLi5mdD97b25QZWVySGFuZHNoYWtlOmZ0fTp7fSwuLi5qPT09dm9pZCAwP3t9OntoYW5kc2hha2VUaW1lb3V0TXM6an0saXNQYXNzaXZlOmllLG9uSGFuZHNoYWtlRXJyb3I6KE8sRCk9PiQ/Lih7ZXJyb3I6RC5yZXBsYWNlKC9eaGFuZHNoYWtlIGZhaWxlZDogLywiIiksYXBwSWQ6VCxwZWVySWQ6Tyxyb29tSWQ6QX0pfTtpW1RdPz89e307bGV0IFdyPWwoVCksRnI9d3IoTz0+dm49TyxPPT57aWYoTSlyZXR1cm47bGV0IEQ9Si5wZWVyU3RhdGVzW09dO0Q/LmNvbm5lY3RlZFBlZXImJihELmNvbm5lY3RlZFBlZXI9bnVsbCxjZShEKSxlbigpKX0sKCk9PntNPSEwLHZuPVY7bGV0IE89c1tUXT8uW0FdO08/LnJvb21Ub2tlbiYmKHAoVCxPLnJvb21Ub2tlbiwhMSksZGVsZXRlIHJbVF0/LltPLnJvb21Ub2tlbl0scltUXSYmIVEocltUXSkubGVuZ3RoJiZkZWxldGUgcltUXSksc1tUXSYmKGRlbGV0ZSBzW1RdW0FdLFEoc1tUXSkubGVuZ3RofHxkZWxldGUgc1tUXSksbWUoSi5wZWVyU3RhdGVzKS5mb3JFYWNoKChbRCxMXSk9PntpZihMLmFuc3dlcmluZ0V4cGlyeVRpbWVyPV8oTC5hbnN3ZXJpbmdFeHBpcnlUaW1lciksTC5jb25uZWN0ZWRQZWVyJiYhTC5jb25uZWN0ZWRQZWVyLmlzRGVhZCl7bGV0IFg9a1tEXTsoIVh8fFgucGVlciE9PUwuY29ubmVjdGVkUGVlcikmJkwuY29ubmVjdGVkUGVlci5kZXN0cm95KCl9TC5hbnN3ZXJpbmdQZWVyJiYhTC5hbnN3ZXJpbmdQZWVyLmlzRGVhZCYmTC5hbnN3ZXJpbmdQZWVyLmRlc3Ryb3koKSxxZShMLHRlKSxMLmNvbm5lY3RlZFBlZXI9bnVsbCxMLmFuc3dlcmluZ1BlZXI9bnVsbCxjZShMKX0pLGlbVF0mJihkZWxldGUgaVtUXVtBXSxRKGlbVF0pLmxlbmd0aD09PTAmJmRlbGV0ZSBpW1RdKSxJZS5mb3JFYWNoKF8pLEVlPV8oRWUpLGN0LmZvckVhY2goYXN5bmMgRD0+eyhhd2FpdCBEKSgpfSksIXUoKSYmKEI9ITEsdGUuZGVzdHJveSgpLEM9bnVsbCxIKCksYihUKSl9LCRyKTtyZXR1cm4gQWU9e3Jvb21Ub2tlbjpudWxsLHJvb21Ub2tlblByb21pc2U6UyxhdHRhY2hTaGFyZWRQZWVyVG9Sb29tOldlLHNob3VsZEFkdmVydGlzZTooKT0+IWllfHxKLmlzQWN0aXZlfSxXcltBXT1BZSxTLnRoZW4oTz0+e2xldCBEPUFlOyFEfHxNfHxzW1RdPy5bQV0hPT1EfHwoRC5yb29tVG9rZW49TyxmKFQpW09dPUEsd2UoaykuZm9yRWFjaChMPT57TC5yZW1vdGVSb29tVG9rZW5zLmhhcyhPKSYmV2UoTC5wZWVySWQsTCl9KSwoIWllfHxKLmlzQWN0aXZlKSYmcChULE8sITApKX0pLGlbVF1bQV09RnJ9fTt2YXIgdXM9WyJvZmZlciIsImFuc3dlciIsImNhbmRpZGF0ZSJdLGRzPTZlNCxtcz1lPT57aWYodHlwZW9mIGU9PSJzdHJpbmciKXRyeXtsZXQgbj1oZShlKTtyZXR1cm4gbiYmdHlwZW9mIG49PSJvYmplY3QiP246bnVsbH1jYXRjaHtyZXR1cm4gbnVsbH1yZXR1cm4gZX0sUW49KGUsbik9PnR5cGVvZiBlW25dPT0ic3RyaW5nIiYmZVtuXT9lW25dOnZvaWQgMCxncz1lPT51cy5zb21lKG49Pm4gaW4gZSYmKHR5cGVvZiBlW25dIT0ic3RyaW5nInx8ZVtuXT09PSIiKSksaHM9ZT0+e2xldCBuPW1zKGUpO2lmKCFufHxncyhuKSlyZXR1cm4hMTtsZXQgdD1RbihuLCJwZWVySWQiKTtyZXR1cm4hISh0JiZ0IT09WSYmbi5wYXNzaXZlIT09ITAmJiFRbihuLCJhbnN3ZXIiKSYmIVFuKG4sImNhbmRpZGF0ZSIpKX0sZXQ9ZT0+e2lmKCFlKXRocm93IEkoInRvcGljIHN0cmF0ZWd5IG1pc3Npbmcgcm9vbSBjb250ZXh0Iik7cmV0dXJuIGV9LEJyPShlLG4sdCxvKT0+KHtraW5kOm4sYXBwSWQ6ZS5hcHBJZCxyb29tSWQ6ZS5yb29tSWQscm9vdFRvcGljOnQsc2VsZlRvcGljOm99KSxudD0oZSxuLHQsbyk9Pih7a2luZDpuLGFwcElkOmUuYXBwSWQscm9vbUlkOmUucm9vbUlkLHJvb3RUb3BpYzp0LHNlbGZUb3BpYzpvfSksdHQ9KHtzdGVhZHlBbm5vdW5jZUludGVydmFsTXM6ZT1kcyxyZWFubm91bmNlT25EaXNjb25uZWN0Om49ITAsaW5pdDp0LHN1YnNjcmliZVRvcGljOm8scHVibGlzaFRvcGljOmksdW5wdWJsaXNoVG9waWM6c30pPT5Zbih7aW5pdDp0LHN1YnNjcmliZTphc3luYyhyLGEsYyx1LGwsZik9PntsZXQgZD1ldChmKSxnPSh2LEEpPT57aShyLHYsQSxudChkLCJzaWduYWwiLGEsYykpfSxwPW51bGwsUj0hMSxiPW51bGwsQj0hMSx3PXY9PntSfHwoUj0hMCx2KCkpfSxDPSgpPT4oYnx8KGI9UHJvbWlzZS5yZXNvbHZlKG8ocixjLCh2LEEpPT57Qnx8dSh2LEEsZyl9LEJyKGQsInNlbGYiLGEsYykpKS50aGVuKHY9PntwPXYsQiYmdyh2KX0pKSxiKTtkLmlzUGFzc2l2ZXx8YXdhaXQgQygpO2xldCBIPWF3YWl0IG8ocixhLGFzeW5jKHYsQSk9PntCfHwoZC5pc1Bhc3NpdmUmJmhzKEEpJiZhd2FpdCBDKCksQnx8YXdhaXQgdSh2LEEsZykpfSxCcihkLCJyb290IixhLGMpKTtyZXR1cm4oKT0+e0I9ITAscCYmdyhwKSxIKCl9fSxhbm5vdW5jZTphc3luYyhyLGEsYyx1LGwpPT57bGV0IGY9ZXQobCksZD1hd2FpdCBpKHIsYSxaKHtwZWVySWQ6WSwuLi51fSksbnQoZiwiYW5ub3VuY2UiLGEsYykpO3JldHVybiB0eXBlb2YgZD09Im51bWJlciJ8fGQhPT12b2lkIDAmJiJzdG9wQW5ub3VuY2luZyJpbiBkP2Q6e25leHRBbm5vdW5jZU1zOmQ/Lm5leHRBbm5vdW5jZU1zPz9lLHJlYW5ub3VuY2VPbkRpc2Nvbm5lY3Q6ZD8ucmVhbm5vdW5jZU9uRGlzY29ubmVjdD8/bn19LC4uLnM/e2RlYWN0aXZhdGU6KHIsYSxjLHUpPT57bGV0IGw9ZXQodSk7cmV0dXJuIHMocixhLG50KGwsImFubm91bmNlIixhLGMpKX19Ont9fSk7dmFyIERyPWpuKGU9PmUuc29ja2V0KSxwcz01LExyPSJ4Iix4cj0iRVZFTlQiLHtzZWNyZXRLZXk6eXMscHVibGljS2V5OndzfT1Dbi5rZXlnZW4oKSxQcz1rZSh3cyksSHI9e30sa3M9e30sdnM9e30sT3I9MjUwLHBuPTZlNCxTcz0xNSo2ZTQsYnM9NTMzMyxRZT1uZXcgV2Vha01hcCxvdD1uZXcgV2Vha1NldCxIZT1uZXcgV2Vha01hcCxDcj1lPT57bGV0IG49UWUuZ2V0KGUpLHQ9TWF0aC5taW4obj8uZGVsYXlNcz9NYXRoLm1heChwbixuLmRlbGF5TXMqMik6cG4sU3MpO3JldHVybiBRZS5zZXQoZSx7ZGVsYXlNczp0LHVudGlsTXM6RGF0ZS5ub3coKSt0fSksdH0sVHM9ZT0+e2xldCBuPVFlLmdldChlKTtpZighbilyZXR1cm4gMDtsZXQgdD1uLnVudGlsTXMtRGF0ZS5ub3coKTtyZXR1cm4gdD4wP3Q6MH0scnQ9ZT0+KHtuZXh0QW5ub3VuY2VNczplfSksUnM9e3N0b3BBbm5vdW5jaW5nOiEwfSxBcz1lPT57aWYob3QuaGFzKGUpKXJldHVybiExO2xldCBuPUhlLmdldChlKTtyZXR1cm4gbiYmKGNsZWFyVGltZW91dChuLnRpbWVyKSxIZS5kZWxldGUoZSkpLG90LmFkZChlKSxRZS5kZWxldGUoZSksZS5jbG9zZT8uKCksITB9LEVzPShlLG4pPT57bGV0IHQ9SGUuZ2V0KGUpO3QmJihjbGVhclRpbWVvdXQodC50aW1lciksdC5ldmVudElkcy5hZGQobikpO2xldCBvPXQ/LmV2ZW50SWRzPz9uZXcgU2V0KFtuXSksaT1zZXRUaW1lb3V0KCgpPT57SGUuZGVsZXRlKGUpfSxicyk7SGUuc2V0KGUse2V2ZW50SWRzOm8sdGltZXI6aX0pfSxNcz0oZSxuKT0+e2xldCB0PUhlLmdldChlKTtyZXR1cm4gdD8uZXZlbnRJZHMuaGFzKG4pPyhjbGVhclRpbWVvdXQodC50aW1lciksSGUuZGVsZXRlKGUpLCEwKTohMX0sc3Q9KCk9Pk1hdGguZmxvb3IoRGF0ZS5ub3coKS8xZTMpLGF0PWU9PnZzW2VdPz89Y24oZSwxZTQpKzJlNCxCcz1hc3luYyhlLG4pPT57bGV0IHQ9e2tpbmQ6YXQoZSksdGFnczpbW0xyLGVdXSxjcmVhdGVkX2F0OnN0KCksY29udGVudDpuLHB1YmtleTpQc30sbz1hd2FpdCBMZSgiU0hBLTI1NiIsWihbMCx0LnB1YmtleSx0LmNyZWF0ZWRfYXQsdC5raW5kLHQudGFncyx0LmNvbnRlbnRdKSk7cmV0dXJuIFooW3hyLHsuLi50LGlkOmtlKG8pLHNpZzprZShhd2FpdCBDbi5zaWduQXN5bmMobyx5cykpfV0pfSx4YT0oZSxuKT0+KEhyW2VdPW4sWihbIlJFUSIsZSx7a2luZHM6W2F0KG4pXSxzaW5jZTpzdCgpLCIjeCI6W25dfV0pKSxfZT17fSxfcj1lPT57ZS5mbHVzaFdhaXRlcnMuZm9yRWFjaChuPT5uKCkpLGUuZmx1c2hXYWl0ZXJzLmNsZWFyKCl9LE9zPShlLG4sdCk9PntsZXQgbz1fZVtlLnVybF0/Pz17c3ViSWRzOltdLHRvcGljczpuZXcgTWFwLHVwZGF0ZVRpbWVyOm51bGwsZmx1c2hXYWl0ZXJzOm5ldyBTZXR9O28udG9waWNzLnNldChuLHQpLElyKGUsbyl9LENzPShlLG4pPT57bGV0IHQ9X2VbZS51cmxdO3QmJih0LnRvcGljcy5kZWxldGUobiksdC50b3BpY3Muc2l6ZT09PTA/KHQudXBkYXRlVGltZXIhPT1udWxsJiYoY2xlYXJUaW1lb3V0KHQudXBkYXRlVGltZXIpLHQudXBkYXRlVGltZXI9bnVsbCksX3IodCksdC5zdWJJZHMuZm9yRWFjaChvPT5lLnNlbmQoWihbIkNMT1NFIixvXSkpKSxkZWxldGUgX2VbZS51cmxdKTpJcihlLHQpKX0sSXI9KGUsbik9PntuLnVwZGF0ZVRpbWVyPT09bnVsbCYmKG4udXBkYXRlVGltZXI9c2V0VGltZW91dCgoKT0+e24udXBkYXRlVGltZXI9bnVsbDt0cnl7TnIoZSl9ZmluYWxseXtfcihuKX19LDApKX0sRHM9ZT0+e2xldCBuPV9lW2UudXJsXTtyZXR1cm4hbnx8bi51cGRhdGVUaW1lcj09PW51bGw/UHJvbWlzZS5yZXNvbHZlKCk6bmV3IFByb21pc2UodD0+bi5mbHVzaFdhaXRlcnMuYWRkKHQpKX0sTnI9ZT0+e2xldCBuPV9lW2UudXJsXTtpZighbnx8bi50b3BpY3Muc2l6ZT09PTApcmV0dXJuO2xldCB0PVsuLi5uLnRvcGljcy5rZXlzKCldLG89W10saT1zdCgpO2ZvcihsZXQgcz0wO3M8dC5sZW5ndGg7cys9T3Ipby5wdXNoKHQuc2xpY2UocyxzK09yKSk7Zm9yKDtuLnN1Yklkcy5sZW5ndGg+by5sZW5ndGg7KXtsZXQgcz1uLnN1Yklkcy5wb3AoKTtzJiZlLnNlbmQoWihbIkNMT1NFIixzXSkpfW8uZm9yRWFjaCgocyxyKT0+e2xldCBhPW4uc3ViSWRzW3JdPz89bGUoNjQpO2Uuc2VuZChaKFsiUkVRIixhLHtraW5kczpbLi4ubmV3IFNldChzLm1hcChhdCkpXSxzaW5jZTppLCIjeCI6c31dKSl9KX0sTHM9ZT0+e2xldCBuPV9lW2UudXJsXTtuJiZuLnRvcGljcy5zaXplPjAmJk5yKGUpfSxIYT10dCh7aW5pdDplPT5JbihlLHhzLHBzLCEwKS5tYXAobj0+e2xldCB0PURyLnJlZ2lzdGVyKG4sKCk9PktuKG4sbz0+e2xldFtpLHMscixhXT1oZShvKTtpZihpIT09eHIpe2xldCBjPWAke0d9OiByZWxheSBmYWlsdXJlIGZyb20gJHt0LnVybH0gLSBgLHU9aT09PSJDTE9TRUQiJiZ0eXBlb2Ygcj09InN0cmluZyI/cjphLGw9aT09PSJPSyImJnI9PT0hMSxmPWwmJnU/LnN0YXJ0c1dpdGgoInJhdGUtbGltaXRlZDoiKSxkPWwmJnU/LnN0YXJ0c1dpdGgoImR1cGxpY2F0ZToiKSxnPWk9PT0iQ0xPU0VEInx8bCYmIWYmJiFkLHA9aT09PSJPSyImJk1zKHQscyk7aWYoZyYmIUFzKHQpKXJldHVybjtmP0NyKHQpOnAmJlFlLmRlbGV0ZSh0KSwhZCYmZS5yZWxheUNvbmZpZz8ud2Fybk9uUmVsYXlGYWlsdXJlIT09ITEmJihpPT09Ik5PVElDRSI/Y29uc29sZS53YXJuKGMrcyk6KGx8fGk9PT0iQ0xPU0VEIikmJmNvbnNvbGUud2FybihjK3UpKTtyZXR1cm59aWYociYmdHlwZW9mIHI9PSJvYmplY3QiJiYiY29udGVudCJpbiByKXtsZXR7Y29udGVudDpjfT1yLHU9a3Nbc107aWYodSl7dShIcltzXT8/IiIsYyk7cmV0dXJufWxldCBsPV9lW3QudXJsXTtpZihsPy5zdWJJZHMuaW5jbHVkZXMocykmJnIudGFncyl7bGV0IGY9ci50YWdzLmZpbmQoZD0+ZFswXT09PUxyKTtmPy5bMV0mJmwudG9waWNzLmdldChmWzFdKT8uKGZbMV0sYyl9fX0sKCk9PkxzKHQpKSk7cmV0dXJuIHQucmVhZHl9KSxzdWJzY3JpYmVUb3BpYzooZSxuLHQsbyk9PntPcyhlLG4sKHIsYSk9Pnt0KHIsYSl9KTtsZXQgcz0oKT0+e0NzKGUsbil9O3JldHVybiBvLmtpbmQ9PT0icm9vdCI/RHMoZSkudGhlbigoKT0+cyk6c30scHVibGlzaFRvcGljOmFzeW5jKGUsbix0LG8pPT57aWYob3QuaGFzKGUpfHxlLmlzQ2xvc2VkKXJldHVybiBvLmtpbmQ9PT0iYW5ub3VuY2UiP1JzOnZvaWQgMDtpZihvLmtpbmQ9PT0iYW5ub3VuY2UiKXtsZXQgYT1UcyhlKTtpZihhPjApcmV0dXJuIHJ0KE1hdGgubWF4KHBuLGEpKX1sZXQgaT1hd2FpdCBCcyhuLHR5cGVvZiB0PT0ic3RyaW5nIj90OloodCkpLHM9ZS5zb2NrZXQucmVhZHlTdGF0ZT09PTE7aWYoZS5zZW5kKGkpLG8ua2luZCE9PSJhbm5vdW5jZSIpcmV0dXJuO2lmKCFzKXJldHVybiBydChDcihlKSk7bGV0IHI9aGUoaSlbMV0uaWQ7cmV0dXJuIEVzKGUscikscnQocG4pfX0pLF9hPURyLmdldFNvY2tldHMseHM9WyJiYXNzcGlzdG9sLm9yZyIsImJ1Y2tldC5jb3JhY2xlLnNvY2lhbCIsImNob3J1cy5wanYubWUiLCJrb3J1LmJpdGNvaW50eG9rby5vcmciLCJub3MubG9sIiwibm9zdHItMDEudWlkLm92aCIsIm5vc3RyLTAxLnlha2lob25uZS5jb20iLCJub3N0ci1yZWxheS5jb3JiLm5ldCIsIm5vc3RyLmRhdGEuaGF1cyIsIm5vc3RyLmlzbGFuZGFyZWEubmV0Iiwibm9zdHIuc2F0aG9hcmRlci5jb20iLCJub3N0ci50ZWdpbGEuY29tLmJyIiwibm9zdHIudnVscGVtLmNvbSIsInB1cnBsZXJlbGF5LmNvbSIsInJlbGF5LWNhbi56b21iaS5jbG91ZHJvZGlvbi5jb20iLCJyZWxheS1ycGkuZWR1ZmVlZC5vcmciLCJyZWxheS5hZ29yaXN0LnNwYWNlIiwicmVsYXkuYXJ0aW8uaW5mLnVuaWJlLmNoIiwicmVsYXkubW9zdHIucHViIiwicmVsYXkubW9zdHJvLm5ldHdvcmsiLCJyZWxheS5zaWdpdC5pbyIsInJlbGF5MDIubG5maS5uZXR3b3JrIiwic2Nobm9yci5tZSIsInNvY2lhbC5hbWFuYWguZWJsZXNzaW5nLmNvIiwic3RhZ2luZy55YWJ1Lm1lIiwic3RyZnJ5LnNob2NrLm5ldHdvcmsiLCJ0b3AudGVzdHJlbGF5LnRvcCIsInlhYnUubWUvdjIiXS5tYXAoZT0+IndzczovLyIrZSk7ZXhwb3J0e0JzIGFzIGNyZWF0ZUV2ZW50LHhzIGFzIGRlZmF1bHRSZWxheVVybHMsX2EgYXMgZ2V0UmVsYXlTb2NrZXRzLEhhIGFzIGpvaW5Sb29tLE5uIGFzIHBhdXNlUmVsYXlSZWNvbm5lY3Rpb24sVW4gYXMgcmVzdW1lUmVsYXlSZWNvbm5lY3Rpb24sWSBhcyBzZWxmSWQseGEgYXMgc3Vic2NyaWJlfTsKLyohIEJ1bmRsZWQgbGljZW5zZSBpbmZvcm1hdGlvbjoKCkBub2JsZS9zZWNwMjU2azEvaW5kZXguanM6CiAgKCohIG5vYmxlLXNlY3AyNTZrMSAtIE1JVCBMaWNlbnNlIChjKSAyMDE5IFBhdWwgTWlsbGVyIChwYXVsbWlsbHIuY29tKSAqKQoqLwovLyMgc291cmNlTWFwcGluZ1VSTD1ub3N0ci5idW5kbGUubWpzLm1hcA==';


// ---- おうむ返しボット用のページ（/bot）----
const BOT_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>おうむ返しボット - ぽちっと通話</title>
  <style>
    :root { --bg: #1a1e24; --card: #252b36; --text: #f3f4f6; --muted: #9ca3af; --ok: #10b981; --tx: #ef4444; --acc: #3b82f6; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 16px; display: flex; justify-content: center; }
    .wrap { width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 14px; }
    .card { background: var(--card); border: 2px solid #374151; border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    h1 { font-size: 1.1rem; color: #93c5fd; }
    .muted { color: var(--muted); font-size: 0.85rem; }
    button { background: #374151; color: #fff; border: none; border-radius: 10px; padding: 12px; font-size: 1rem; font-weight: 700; cursor: pointer; }
    button.primary { background: #2563eb; }
    button:disabled { opacity: .5; cursor: default; }
    .status { font-family: monospace; font-size: 1.05rem; font-weight: 800; }
    .status.on { color: var(--ok); }
    .url { font-size: 0.78rem; word-break: break-all; user-select: text; color: #93c5fd; }
    .peer { display: flex; justify-content: space-between; gap: 8px; font-size: 0.9rem; padding: 6px 10px; background: #1e293b; border-radius: 8px; }
    .peer.rec { background: #7f1d1d; } .peer.reply { background: #064e3b; }
    #log { font-family: monospace; font-size: 0.75rem; color: var(--muted); max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>おうむ返しボット</h1>
      <p class="muted">この部屋で話した人の声を録音して、その人にだけ返します。このタブを開いたままにしてください。</p>
      <div class="status" id="status">停止中</div>
      <div class="muted" id="health"></div>
      <button class="primary" id="startBtn" type="button" disabled>読み込み中…</button>
      <label class="muted" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="autoCheck" checked style="margin-top:3px"><span>自動で起動・再起動する（開いたときに自動で始め、固まったら自分で作り直し、新しい版が出たら自分で入れ替わります）</span></label>
      <div class="muted">招待URL（通話テスト用の部屋。通常のページの、設定からも入れます）</div>
      <div class="url" id="inviteUrl"></div>
    </div>
    <div class="card">
      <div class="muted">いま接続している人</div>
      <div id="peers"><span class="muted">（まだいません）</span></div>
    </div>
    <div class="card">
      <div class="muted">ログ</div>
      <div id="log"></div>
    </div>
  </div>

  <script>
    // ブラウザの接続オブジェクト（RTCPeerConnection）は、ページあたり約500本が上限。数を数えておき、増えすぎたら、つなぎ直す
    window.pcStat = { created: 0, closed: 0 };
    // 失敗した接続のエラーは、よく出る（相手の回線のせい。通話の仕組み側の、後片付けの順序の問題）。
    // 画面とコンソールを埋めないよう、一番最初から数えるだけにする
    window.ignoredErrors = 0;
    window.isNoisyError = function (msg) {
      return /so many PeerConnections|Connection failed|ICE failed|User-Initiated Abort|Close called|InvalidStateError|wrong state|setRemoteDescription|Cannot read properties of null|localDescription|Failed to execute .(addIceCandidate|createAnswer|createOffer)/i.test(msg || '');
    };
    window.addEventListener('error', function (e) { if (window.isNoisyError(e.message || (e.error && e.error.message))) { e.preventDefault(); window.ignoredErrors++; } }, true);
    window.addEventListener('unhandledrejection', function (e) { const r = e.reason; if (window.isNoisyError(r && (r.message || String(r)))) { e.preventDefault(); window.ignoredErrors++; } }, true);
    (function () {
      const O = window.RTCPeerConnection;
      if (!O) return;
      window.RTCPeerConnection = class extends O {
        constructor(...a) {
          super(...a);
          window.pcStat.created++;
          const c = this.close.bind(this);
          let done = false;
          this.close = function () { if (!done) { done = true; window.pcStat.closed++; } return c(); };
        }
      };
    })();
  </script>
  <script type="module">
    import { joinRoom } from '/vendor/trystero-0.25.4-p8.mjs';

    const APP_ID = 'pochitalk-v2';
    const BOT_NAME = 'おうむ返しボット';
    const BOT_TAG = '🦜 話すと、あなたにだけ声が返ります';
    const ALL_RELAYS = ['wss://relay.primal.net', 'wss://purplerelay.com', 'wss://bucket.coracle.social', 'wss://yabu.me/v2', 'wss://x.kojira.io', 'wss://relay.notoshi.win', 'wss://relay.ditto.pub'];
    // 使うリレーは、起動時に動いているものを選ぶ（最大5本）。全部を使わないことで、接続の作り直しの量を減らす
    let RELAYS = ALL_RELAYS.slice(0, 5);
    // 起動時に、各リレーに実際につないでみて、動いているものだけを選ぶ（落ちているリレーは、つなぎ直しを繰り返して、エラーを出し続けるため）
    function probeRelay(url) {
      return new Promise(function (resolve) {
        let settled = false, ws = null, timer = null;
        const done = function (ok) { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
        try { ws = new WebSocket(url); } catch (_) { done(false); return; }
        // 時間切れでも、ソケットは閉じない（接続中に閉じると、ブラウザが警告を出し続けるため）。あとで開いたら、そのとき閉じる
        timer = setTimeout(function () { done(false); }, 6000);
        ws.onopen = function () { done(true); try { ws.close(); } catch (_) {} };
        ws.onerror = function () { done(false); };
        ws.onclose = function () { done(false); };
      });
    }
    const sleepMs = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    async function pickRelays() {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await Promise.all(ALL_RELAYS.map(function (u) { return probeRelay(u).then(function (ok) { return { u: u, ok: ok }; }); }));
        const alive = res.filter(function (r) { return r.ok; }).map(function (r) { return r.u; }).sort(function () { return Math.random() - 0.5; });
        log('使えるリレー: ' + alive.length + ' / ' + ALL_RELAYS.length + '（落ちているリレーは使いません）');
        if (alive.length >= 1) return alive.slice(0, 3); // 接続の準備の数は、リレーの数に比例する。動いているものを3本まで使う
        log('使えるリレーがありません。10秒後にもう一度確かめます');
        await sleepMs(10000);
      }
      log('リレーを確認できなかったため、すべてのリレーを使います');
      return ALL_RELAYS;
    }
    const qkey = (new URLSearchParams(location.search).get('r') || '').trim().toLowerCase();
    const BOT_KEY = /^[0-9a-f]{8}$/.test(qkey) ? qkey : '7a0b07c1';
    const MIN_MS = 350, MAX_MS = 40000, REPLY_DELAY_MS = 250;
    const botSince = Date.now();
    // ロビー（アプリを開いている全員と、つなごうとする仕組み）は、人が多いと、接続の準備が大量に溜まる。ボットは、招待URLで入ってもらえば足りるので、通常は入らない
    const BOT_VERSION = '__VERSION__'; // 貼り付けた版が最新か、画面で確認するための印

    const $ = function (id) { return document.getElementById(id); };
    function fmt(k) { return k.slice(0, 4).toUpperCase() + '·' + k.slice(4).toUpperCase(); }
    function log(msg) {
      const d = document.createElement('div');
      d.textContent = new Date().toLocaleTimeString() + '  ' + msg;
      const box = $('log');
      box.appendChild(d);
      while (box.children.length > 60) box.removeChild(box.firstChild);
      box.scrollTop = box.scrollHeight;
    }
    $('inviteUrl').textContent = location.origin + '/?r=' + BOT_KEY;

    // 失敗した接続のエラーは、よく出る（相手の回線のせい）。画面とコンソールを埋めないよう、数えるだけにする
    function liveConnections() { return window.pcStat.created - window.pcStat.closed; }
    function showHealth() {
      const mode = hasTurn ? (FORCE_RELAY ? 'TURN 中継固定' : 'TURN あり（直接を優先）') : 'STUN 直接';
      $('health').textContent = '接続方式: ' + mode + ' / 一覧への在室通知: ' + (typeof presenceSocks === 'function' ? presenceSocks() : 0) + ' 本のリレーに送信中' + ' / この部屋: ' + peers.size + ' 人'
        + ' / 音声: ' + (ctx && ctx.state === 'running' ? '動作中' : '許可待ち（このタブを1回クリック）') + ' / 接続オブジェクト: ' + liveConnections() + ' 本 / 無視した接続エラー: ' + window.ignoredErrors + ' 件 / 版: ' + BOT_VERSION + (standby ? ' / 待機中（先のボットが動いています）' : '');
    }

    // 接続設定（Cloudflare TURN が取れれば、中継固定。取れなければ STUN の直接接続）
    const rtcConf = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }] }; // Trystero 0.25.4: そのまま RTCPeerConnection の設定
    async function loadIce() {
      try {
        const res = await fetch('/api/turn', { cache: 'no-store' });
        if (!res.ok) return hasTurn;
        const data = await res.json();
        if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
          rtcConf.iceServers = data.iceServers.concat([{ urls: 'stun:stun.l.google.com:19302' }]);
          hasTurn = true;
          rtcConf.iceTransportPolicy = FORCE_RELAY ? 'relay' : 'all'; // 通常は、直接を優先し、つながらないときだけ中継
        }
      } catch (_) {}
      return hasTurn;
    }
    const FORCE_RELAY = new URLSearchParams(location.search).has('relay');
    let hasTurn = false;   // TURN の鍵が取れているか
    let usedRelay = false; // いまの接続が、TURN ありで作られているか

    let ctx = null, room = null, lobby = null, started = false, watchdog = null, wake = null;
    let sendState = null, sendName = null, sendAge = null, sendTag = null, sendPresence = null;
    const peers = new Map(); // id -> { name, talking, stream, audio, dest, rec, reply }


    // Trystero 0.25.4 の API 差を吸収する小さな部品（0.20.0 の書き方のまま、呼び出し側を動かすため）
    //  ・makeAction は、{ send, onMessage } を返す。受信は onMessage(data, { peerId })。送信は send(data, { target })
    //  ・onPeerJoin / onPeerLeave / onPeerStream は、関数を代入して設定する
    function actionOf(r, id) {
      const a = r.makeAction(id);
      return [
        function (data, peerId) { return a.send(data, peerId ? { target: peerId } : undefined); },
        function (handler) { a.onMessage = function (data, info) { handler(data, info && info.peerId); }; }
      ];
    }
    function setHandler(r, name, fn) { r[name] = fn; }

    function renderPeers() {
      const box = $('peers');
      box.innerHTML = '';
      if (!peers.size) { box.innerHTML = '<span class="muted">（まだいません）</span>'; return; }
      peers.forEach(function (p) {
        const row = document.createElement('div');
        row.className = 'peer' + (p.reply ? ' reply' : (p.rec ? ' rec' : ''));
        const n = document.createElement('span'); n.textContent = p.name || '接続中…';
        const s = document.createElement('span'); s.textContent = p.reply ? '返信中' : (p.rec ? '録音中' : '待機');
        row.appendChild(n); row.appendChild(s);
        box.appendChild(row);
      });
    }

    function stopReply(id, p) {
      if (!p.reply) return;
      try { p.reply.src.onended = null; p.reply.src.stop(); } catch (_) {}
      clearTimeout(p.reply.timer);
      p.reply = null;
      if (sendState) sendState({ isTalking: false }, id);
      renderPeers();
    }

    function startRec(id, p) {
      if (!p.stream) { log((p.name || id.slice(0, 5)) + ': 音声がまだ届いていません'); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); });
      let mr;
      try { mr = mime ? new MediaRecorder(p.stream, { mimeType: mime }) : new MediaRecorder(p.stream); } catch (e) { log('録音を始められません: ' + e.message); return; }
      const rec = { mr: mr, chunks: [], start: Date.now(), timer: null, mime: mr.mimeType };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
      mr.start();
      rec.timer = setTimeout(function () { stopRec(id, p); }, MAX_MS);
      p.rec = rec;
      renderPeers();
    }

    function stopRec(id, p) {
      const rec = p.rec;
      if (!rec) return;
      p.rec = null;
      clearTimeout(rec.timer);
      const ms = Date.now() - rec.start;
      rec.mr.onstop = async function () {
        renderPeers();
        if (ms < MIN_MS || !rec.chunks.length || !peers.has(id)) return;
        try {
          const blob = new Blob(rec.chunks, { type: rec.mime || 'audio/webm' });
          const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
          playBack(id, p, buf, ms);
        } catch (e) { log((p.name || id.slice(0, 5)) + ': 録音を読み取れませんでした（' + e.message + '）'); }
      };
      try { rec.mr.stop(); } catch (_) { renderPeers(); }
    }

    function playBack(id, p, buf, ms) {
      if (!peers.has(id) || p.talking) return; // 返す前に、また話し始めたら返さない
      stopReply(id, p);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(p.dest);
      const reply = { src: src, timer: null };
      p.reply = reply;
      reply.timer = setTimeout(async function () {
        if (p.reply !== reply) return;
        // 音声が「許可待ち」（ブラウザが、操作なしの再生を許さない）のときは、再生が始まらず、終わりも来ない。
        // それなのに「話している」と知らせると、相手の画面が、ずっと受信中のままになるので、再開を試し、だめなら、返事を出さない
        if (ctx.state !== 'running') { try { await Promise.race([ctx.resume(), new Promise(function (r) { setTimeout(r, 600); })]); } catch (_) {} }
        if (p.reply !== reply) return;
        if (ctx.state !== 'running') {
          p.reply = null;
          log('音声が許可待ちのため、返事を出せません。このタブを1回クリックしてください（ブラウザを --autoplay-policy=no-user-gesture-required で起動すれば、クリックは要りません）');
          renderPeers(); showHealth();
          return;
        }
        if (sendState) sendState({ isTalking: true }, id);
        let ended = false, guard = null;
        const finish = function () { // 再生が終わったとき。終わりの知らせが来なくても、長さ+1.5秒で、必ず終わらせる
          if (ended) return;
          ended = true; clearTimeout(guard);
          if (p.reply === reply) { p.reply = null; if (sendState) sendState({ isTalking: false }, id); renderPeers(); }
        };
        src.onended = finish;
        guard = setTimeout(finish, buf.duration * 1000 + 1500);
        src.start();
        log((p.name || id.slice(0, 5)) + ': ' + (ms / 1000).toFixed(1) + '秒の声を返しています');
        renderPeers();
      }, REPLY_DELAY_MS);
      renderPeers();
    }

    function joinBotRoom() {
      room = joinRoom({ appId: APP_ID, relayConfig: { urls: RELAYS, warnOnRelayFailure: false }, rtcConfig: rtcConf }, 'h-' + BOT_KEY);
      const st = actionOf(room, 'pttState'), nm = actionOf(room, 'pttName'), ag = actionOf(room, 'joinAge'), tg = actionOf(room, 'roomTag');
      sendState = st[0]; sendName = nm[0]; sendAge = ag[0]; sendTag = tg[0];
      // ほかのボットを見つけたら、どちらが先に動いていたかを見る（roomTag の at が、ボットの起動時刻）
      tg[1](function (data, id) {
        const p = peers.get(id);
        if (p && data && data.by === BOT_NAME && typeof data.at === 'number') { p.isBot = true; p.botSince = data.at; refreshStandby(); }
      });
      nm[1](function (name, id) { const p = peers.get(id); if (p) { p.name = String(name).slice(0, 20); renderPeers(); } });
      st[1](function (state, id) {
        const p = peers.get(id);
        if (!p || !state) return;
        if (standby) return; // 先に動いているボットがいるときは、返事をしない
        p.talking = !!state.isTalking;
        if (p.talking) { stopReply(id, p); startRec(id, p); } else { stopRec(id, p); }
      });
      setHandler(room, 'onPeerJoin', function (id) {
        const dest = ctx.createMediaStreamDestination();
        peers.set(id, { name: '', talking: false, stream: null, audio: null, dest: dest, rec: null, reply: null });
        room.addStream(dest.stream, { target: id }); // 返事は、この人専用の音声として送る
        sendName(BOT_NAME, id);
        sendAge({ age: 3600 * 1000 }, id); // 古株として見せる（入室音を鳴らさせない）
        sendTag({ tag: BOT_TAG, by: BOT_NAME, at: botSince }, id);
        renderPeers();
        log('参加: ' + id.slice(0, 5));
      });
      setHandler(room, 'onPeerLeave', function (id) {
        const p = peers.get(id);
        if (p) { stopReply(id, p); if (p.rec) { clearTimeout(p.rec.timer); try { p.rec.mr.stop(); } catch (_) {} } if (p.audio) { p.audio.srcObject = null; } }
        peers.delete(id);
        refreshStandby();
        renderPeers();
        log('退出: ' + ((p && p.name) || id.slice(0, 5)));
      });
      setHandler(room, 'onPeerStream', function (stream, id) {
        const p = peers.get(id);
        if (!p) return;
        p.stream = stream;
        // 受信音声は、再生要素につないでおかないと、ブラウザが流してくれないことがある（音量0で再生）
        const a = new Audio();
        a.srcObject = stream; a.volume = 0;
        a.play().catch(function () {});
        p.audio = a;
      });
    }


    // 同じ部屋に、先に動いているボットがいるときは、あとから来たほうは、返事をせずに待機する（2つが同時に返すのを防ぐ）
    let standby = false;
    function refreshStandby() {
      const was = standby;
      standby = Array.from(peers.values()).some(function (p) { return p.isBot && p.botSince < botSince; });
      if (standby !== was) { log(standby ? 'ほかのボットが先に動いているため、返事をせずに待機します' : '先のボットがいなくなったので、返事を始めます'); showHealth(); }
    }
    let busy = false;
    async function reconnect(reason) {
      if (busy) return;
      busy = true;
      try { await reconnectInner(reason); } finally { busy = false; }
    }
    async function reconnectInner(reason) {
      log('つなぎ直します（' + reason + '）');
      const oldRoom = room, oldLobby = lobby;
      room = null; lobby = null;
      peers.forEach(function (p, id) { stopReply(id, p); });
      peers.clear(); renderPeers();
      try { await Promise.all([oldRoom ? oldRoom.leave() : null, oldLobby ? oldLobby.leave() : null]); } catch (_) {}
      await new Promise(function (r) { setTimeout(r, 400); });
      await loadIce();
      usedRelay = hasTurn;
      joinBotRoom();
    }

    // ---------- 部屋の一覧への在室通知（Nostr のリレーに送るだけ。WebRTC は使わない）----------
    const PRESENCE_KIND = 29334, PRESENCE_TOPIC = 'pochitalk-presence-v1';
    const pub = { schnorr: null, priv: null, key: '', socks: new Map(), retry: new Map(), timer: null };
    function hexOf(b) { return Array.from(b).map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
    async function pubInit() {
      if (pub.schnorr) return true;
      try {
        const mod = await import('https://esm.sh/@noble/curves@1.4.0/secp256k1');
        pub.schnorr = mod.schnorr;
        pub.priv = pub.schnorr.utils.randomPrivateKey();
        pub.key = hexOf(pub.schnorr.getPublicKey(pub.priv));
        return true;
      } catch (_) { return false; }
    }
    async function pubEvent(obj) {
      const tags = [['x', PRESENCE_TOPIC]];
      const created = Math.floor(Date.now() / 1000);
      const content = JSON.stringify(obj);
      const ser = JSON.stringify([0, pub.key, created, PRESENCE_KIND, tags, content]);
      const id = hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ser))));
      const sig = hexOf(await pub.schnorr.sign(id, pub.priv));
      return JSON.stringify(['EVENT', { id: id, pubkey: pub.key, created_at: created, kind: PRESENCE_KIND, tags: tags, content: content, sig: sig }]);
    }
    async function pubSend() {
      if (!(await pubInit())) return;
      const ev = await pubEvent({ ch: BOT_KEY, talking: false, name: BOT_NAME, tag: BOT_TAG, by: BOT_NAME, at: botSince });
      pub.socks.forEach(function (ws) { if (ws.readyState === 1) { try { ws.send(ev); } catch (_) {} } });
    }
    function pubOpen(url) {
      if (pub.socks.has(url)) return;
      let ws; try { ws = new WebSocket(url); } catch (_) { return; }
      pub.socks.set(url, ws);
      ws.onopen = function () { pub.retry.set(url, 5000); pubSend(); };
      ws.onclose = function () {
        pub.socks.delete(url);
        const wait = Math.min(pub.retry.get(url) || 5000, 300000);
        pub.retry.set(url, wait * 2);
        setTimeout(function () { pubOpen(url); }, wait);
      };
    }
    function startPresencePublisher() {
      RELAYS.forEach(pubOpen);
      if (!pub.timer) pub.timer = setInterval(pubSend, 6000);
    }
    function presenceSocks() { let n = 0; pub.socks.forEach(function (w) { if (w.readyState === 1) n++; }); return n; }

    // ---------- 自動の起動・再起動 ----------
    const AUTO_KEY = 'pochitalk_bot_auto';
    const MANUAL = new URLSearchParams(location.search).has('manual'); // ?manual=1 で開くと、自動で始めない
    const VCHECK_MS = (parseInt(new URLSearchParams(location.search).get('vcheck'), 10) || 300) * 1000; // 版の確認の間隔（試験用に変えられる）
    function autoOn() { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (_) { return true; } }
    $('autoCheck').checked = autoOn();
    $('autoCheck').addEventListener('change', function () { try { localStorage.setItem(AUTO_KEY, $('autoCheck').checked ? '1' : '0'); } catch (_) {} });
    // 再読み込みが続くときは、無限に繰り返さない（10分に3回まで）
    function reloadSafely(reason) {
      let arr = [];
      try { arr = JSON.parse(sessionStorage.getItem('bot_reloads') || '[]'); } catch (_) {}
      const now = Date.now();
      arr = arr.filter(function (t) { return now - t < 600000; });
      if (arr.length >= 3) { log('再読み込みが続いたため、自動の再読み込みを止めます（手動で確認してください）'); return false; }
      arr.push(now);
      try { sessionStorage.setItem('bot_reloads', JSON.stringify(arr)); } catch (_) {}
      log('再読み込みします（' + reason + '）');
      setTimeout(function () { location.reload(); }, 1500);
      return true;
    }

    async function start() {
      if (started) return;
      started = true;
      $('startBtn').disabled = true;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // 自動で始めたとき（操作なし）は、ブラウザが、音の再開を、操作があるまで許さないことがある。待たずに先へ進み、操作があったら再開する
      ctx.resume().catch(function () {});
      const wakeAudio = function () { if (ctx && ctx.state !== 'running') ctx.resume().catch(function () {}); };
      ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(function (ev) { document.addEventListener(ev, wakeAudio, { passive: true }); });
      RELAYS = await pickRelays();
      for (let i = 0; i < 4 && !(await loadIce()); i++) { await sleepMs(2000); } // 回線の調子が悪くても、鍵を取れるまで少しやり直す
      usedRelay = hasTurn;
      joinBotRoom();
      startPresencePublisher();
      $('status').textContent = '稼働中：' + fmt(BOT_KEY);
      $('status').className = 'status on';
      showHealth();
      log('開始しました（' + (hasTurn ? (FORCE_RELAY ? 'TURN 中継固定' : 'TURN あり・直接を優先') : 'STUN 直接') + '）');
      // 見張り: 10分ごとに TURN の認証情報を取り直し、誰ともつながっていなければ、つなぎ直す
      watchdog = setInterval(async function () {
        await loadIce();
        if (peers.size === 0) reconnect('定期');
      }, 10 * 60 * 1000);
      window.addEventListener('online', function () { reconnect('回線が戻りました'); });
      // 5秒ごとに、接続オブジェクトの数を見張る。増えすぎたら（上限の約500本の手前で）、全部作り直す
      const recent = [];
      let lastGuardAt = 0;
      setInterval(function () {
        showHealth();
        recent.push(window.pcStat.created);
        if (recent.length > 12) recent.shift();
        const lastMinute = window.pcStat.created - recent[0];
        // ブラウザの上限は約500本。手前の400本、または1分に1500本を超えたときだけ作り直す（作り直しの直後90秒は、見送る）
        if (!busy && Date.now() - lastGuardAt > 90000 && (liveConnections() > 400 || lastMinute > 1500)) { lastGuardAt = Date.now(); reconnect('接続が増えすぎました（' + liveConnections() + '本）'); }
      }, 5000);
      // 起動時に TURN の鍵が取れず、STUN 直接で始めたときは、あとで取れたら、中継に切り替える（通常のページは、中継固定のため）
      setInterval(async function () {
        if (usedRelay || busy) return;
        if (await loadIce()) reconnect('TURN の鍵が取れたので、中継に切り替えます');
      }, 30000);
      // ---- 自分で立ち直る ----
      const bootAt = Date.now();
      let lastGoodAt = Date.now(), softDone = false, newVersionAt = 0;
      setInterval(function () {
        const good = presenceSocks() > 0 && !!room;
        if (good) { lastGoodAt = Date.now(); softDone = false; }
        const bad = Date.now() - lastGoodAt;
        if (bad > 180000 && !softDone && !busy) { softDone = true; reconnect('3分間、リレーにつながっていません'); }
        if (bad > 480000) reloadSafely('8分間、リレーにつながっていません');
        // 12時間ごとに、ページごと入れ替える（長く開いたままの汚れを、リセットする）。誰かが部屋にいる間は、延ばす
        if (Date.now() - bootAt > 12 * 3600 * 1000 && peers.size === 0) reloadSafely('12時間ごとの定期の入れ替え');
      }, 15000);
      // 新しい版が出たら、自分で入れ替わる（誰かが部屋にいる間は、最大30分まで待つ）
      setInterval(async function () {
        try {
          const r = await fetch('/version', { cache: 'no-store' });
          const j = await r.json();
          if (j && j.version && j.version !== BOT_VERSION) {
            if (!newVersionAt) { newVersionAt = Date.now(); log('新しい版が出ました: ' + j.version); }
            if (peers.size === 0 || Date.now() - newVersionAt > 1800000) reloadSafely('新しい版（' + j.version + '）へ入れ替え');
          } else { newVersionAt = 0; }
        } catch (_) {}
      }, VCHECK_MS);
      // タブが止められないよう、ロックを持ち続ける（対応していれば）
      try { navigator.locks.request('pochitalk-bot', function () { return new Promise(function () {}); }); } catch (_) {}
      // 画面を消さない（対応していれば）
      const lockScreen = async function () { try { wake = await navigator.wakeLock.request('screen'); } catch (_) {} };
      lockScreen();
      document.addEventListener('visibilitychange', function () { if (!document.hidden) lockScreen(); });
    }
    $('startBtn').addEventListener('click', start);
    if (autoOn() && !MANUAL) { log('自動で開始します'); start(); }
    $('startBtn').disabled = false; // 通話の部品の読み込みが終わった
    $('startBtn').textContent = '開始';
  </script>
</body>
</html>`;



// TURN の鍵は、このファイルに書かない。Worker の「変数とシークレット」に TURN_KEY_ID（テキスト）と TURN_API_TOKEN（シークレット）を登録する。
// 未設定のときは、空の iceServers を返し、ページは STUN の直接接続で動く。
async function handleTurn(request, url, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return new Response('forbidden', { status: 403 });
  const keyId = env && env.TURN_KEY_ID, token = env && env.TURN_API_TOKEN;
  if (!keyId || !token) return new Response(JSON.stringify({ iceServers: [] }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const res = await fetch(
    'https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(keyId) + '/credentials/generate-ice-servers',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ttl: 86400 })
    }
  );
  const text = await res.text();
  if (!res.ok) return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  // TURN の接続先は、2つに絞る（UDP 3478 と、TLS 443）。通話の仕組みは、相手を見つけるたびに、接続の準備を作る。
  // 準備ごとに、TURN の接続先の数だけ割り当てが走るので、多いと詰まって、準備に10秒以上かかり、接続に失敗する
  let body = text;
  try {
    const j = JSON.parse(text);
    j.iceServers = (j.iceServers || []).map(function (sv) {
      const urls = [].concat(sv.urls || []);
      if (!urls.some(function (u) { return /^turns?:/.test(u); })) return sv;
      const keep = urls.filter(function (u) { return u === 'turn:turn.cloudflare.com:3478?transport=udp' || u === 'turns:turn.cloudflare.com:443?transport=tcp'; });
      return Object.assign({}, sv, { urls: keep.length ? keep : urls.slice(0, 2) });
    });
    body = JSON.stringify(j);
  } catch (_) {}
  return new Response(body, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/turn') return handleTurn(request, url, env);
    if (url.pathname === '/version') return new Response(JSON.stringify({ version: APP_VERSION, trystero: '0.25.4' }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (url.pathname === '/vendor/trystero-0.25.4-p8.mjs') return new Response(bytes(TRYSTERO_B64), { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    if (url.pathname === '/bot') return new Response(BOT_HTML.split('__VERSION__').join(APP_VERSION), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-cache' } });
    switch (url.pathname) {
      case '/favicon.svg':
        return new Response(FAVICON_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': CACHE } });
      case '/favicon.png':
      case '/favicon.ico':
        return new Response(bytes(PNG_FAVICON), { headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE } });
      case '/apple-touch-icon.png':
        return new Response(bytes(PNG_APPLE), { headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE } });
      case '/og.png':
        return new Response(bytes(PNG_OG), { headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE } });
    }
    return new Response(HTML.split('__ORIGIN__').join(url.origin).split('__VERSION__').join(APP_VERSION), {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-cache'
      }
    });
  }
};
