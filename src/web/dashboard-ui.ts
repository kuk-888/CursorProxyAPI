/**
 * Precision Infrastructure Console (`GET /dashboard`).
 * Monochrome Geist/Linear engineering aesthetic:
 *  - Overview, Real-Time Request Logs (with Account Filter & Chat-Block Drawer),
 *  - Credentials & Quotas, Model Access Control (Single & Batch Enable/Disable),
 *  - Routing & Sticky Affinity, and Live Playground.
 */
export function renderDashboardHtml(dashboardPath = "/dashboard", nonce = ""): string {
  const serializedDashPath = JSON.stringify(dashboardPath);
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%2318181b'/%3E%3Cstop offset='100%25' stop-color='%2309090b'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='url(%23g)'/%3E%3Crect x='.75' y='.75' width='30.5' height='30.5' rx='7.25' fill='none' stroke='%23ffffff' stroke-opacity='.14'/%3E%3Cpolygon points='16,5.5 25,10.7 16,15.9 7,10.7' fill='%23ffffff' fill-opacity='.92'/%3E%3Cpolygon points='7,10.7 16,15.9 16,26.5 7,21.3' fill='%23ffffff' fill-opacity='.34'/%3E%3Cpolygon points='25,10.7 25,21.3 16,26.5 16,15.9' fill='%23ffffff' fill-opacity='.62'/%3E%3Cpath d='M16 15.9L25 10.7M16 15.9V26.5M16 15.9L7 10.7' stroke='%2309090b' stroke-width='1.1' stroke-linejoin='round'/%3E%3Ccircle cx='25' cy='10.7' r='2.1' fill='%2310b981' stroke='%2309090b' stroke-width='.9'/%3E%3C/svg%3E" />
  <title>CursorProxyAPI Console</title>
  <style>
    :root[data-theme="dark"] {
      --bg: #0a0a0b;
      --panel: #111113;
      --panel-hover: #18181b;
      --subtle: #161619;
      --border: #242429;
      --border-strong: #34343c;
      --fg: #f4f4f5;
      --fg-muted: #a1a1aa;
      --fg-faint: #8e8e98;
      --cta-bg: #f4f4f5;
      --cta-fg: #09090b;
      --cta-hover: #dcdce0;
      --ok: #10b981;
      --warn: #f59e0b;
      --err: #ef4444;
      --track: #222227;
    }
    :root[data-theme="light"] {
      --bg: #fafafa;
      --panel: #ffffff;
      --panel-hover: #f4f4f5;
      --subtle: #f4f4f5;
      --border: #e4e4e7;
      --border-strong: #d4d4d8;
      --fg: #09090b;
      --fg-muted: #52525b;
      --fg-faint: #71717a;
      --cta-bg: #18181b;
      --cta-fg: #ffffff;
      --cta-hover: #27272a;
      --ok: #059669;
      --warn: #d97706;
      --err: #dc2626;
      --track: #e4e4e7;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", "PingFang SC", sans-serif;
      background: var(--bg);
      color: var(--fg);
      font-size: 13px;
      line-height: 1.5;
      font-variant-numeric: tabular-nums;
      -webkit-font-smoothing: antialiased;
    }
    .mono {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
    }

    input, select, textarea {
      font: inherit;
      font-size: 12.5px;
      color: var(--fg);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 10px;
      transition: border-color 0.12s;
    }
    input:not([type="checkbox"]), select { height: 32px; }
    select {
      appearance: none; -webkit-appearance: none;
      padding-right: 28px;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 9px center;
      cursor: pointer;
    }
    select:hover { border-color: var(--border-strong); }
    .c-sel-wrap { position: relative; display: inline-flex; align-items: center; }
    .c-sel-native { position: absolute !important; inset: 0; opacity: 0; pointer-events: none; width: 100%; height: 100%; }
    .c-sel-trigger {
      height: 32px; width: 100%; padding: 0 28px 0 10px;
      background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px;
      font: inherit; font-size: 12.5px; font-weight: 400;
      display: inline-flex; align-items: center; justify-content: flex-start; gap: 6px;
      cursor: pointer; white-space: nowrap; text-align: left;
      transition: border-color 0.12s, background-color 0.12s;
    }
    .c-sel-trigger:hover { border-color: var(--border-strong); background: var(--panel-hover); }
    .c-sel-trigger.open { border-color: var(--fg-muted); }
    .c-sel-trigger-lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .c-sel-chev {
      position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
      width: 12px; height: 12px; color: var(--fg-muted); pointer-events: none; transition: transform 0.14s ease;
    }
    .c-sel-trigger.open + .c-sel-chev { transform: translateY(-50%) rotate(180deg); }
    .c-sel-menu {
      position: fixed; z-index: 120; display: none;
      background: var(--panel); color: var(--fg); border: 1px solid var(--border-strong);
      border-radius: 8px; padding: 4px; min-width: 170px; max-height: 280px; overflow-y: auto;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
    }
    .c-sel-menu.open { display: block; }
    .c-sel-opt {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      width: 100%; padding: 6px 9px; border-radius: 5px; border: none; background: transparent;
      color: var(--fg); font: inherit; font-size: 12.5px; font-weight: 400; text-align: left; cursor: pointer;
    }
    .c-sel-opt:hover { background: var(--panel-hover); }
    .c-sel-opt.active { background: var(--subtle); font-weight: 500; }
    .c-sel-chk { width: 13px; height: 13px; flex-shrink: 0; color: var(--ok); opacity: 0; }
    .c-sel-opt.active .c-sel-chk { opacity: 1; }
    input[type="checkbox"] { width: 15px; height: 15px; padding: 0; cursor: pointer; accent-color: var(--cta-bg); }
    input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, .clickable-row:focus-visible {
      outline: 2px solid var(--fg-muted);
      outline-offset: 2px;
    }
    .switch input:focus-visible + .slider {
      outline: 2px solid var(--fg-muted);
      outline-offset: 2px;
    }
    button {
      font: inherit;
      font-size: 12.5px;
      font-weight: 500;
      height: 32px;
      color: var(--fg);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background-color 0.12s, border-color 0.12s;
      white-space: nowrap;
    }
    button:hover { background: var(--panel-hover); border-color: var(--border-strong); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-solid {
      background: var(--cta-bg);
      color: var(--cta-fg);
      border-color: var(--cta-bg);
    }
    .btn-solid:hover { background: var(--cta-hover); border-color: var(--cta-hover); }
    .btn-ghost { background: transparent; border-color: transparent; color: var(--fg-muted); padding: 5px 8px; }
    .btn-ghost:hover { background: var(--panel-hover); color: var(--fg); border-color: transparent; }
    .btn-danger { color: var(--err); }
    .btn-danger:hover { border-color: var(--err); background: rgba(239,68,68,0.06); }
    .btn-xs { height: 24px; padding: 0 8px; font-size: 11.5px; border-radius: 4px; white-space: nowrap; }

    /* Login Gate */
    #loginGate {
      min-height: 100vh;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .login-box {
      width: 100%;
      max-width: 360px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 28px 24px;
    }
    .login-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .login-mark {
      width: 24px; height: 24px; border: 1px solid var(--border-strong);
      border-radius: 5px; display: flex; align-items: center; justify-content: center;
    }
    .login-head h1 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
    .login-desc { color: var(--fg-muted); font-size: 12px; margin-bottom: 20px; }
    .login-form { display: flex; flex-direction: column; gap: 12px; }
    .login-form input { width: 100%; padding: 8px 11px; }
    .login-form button { width: 100%; padding: 8px 12px; font-size: 13px; }
    .login-err { color: var(--err); font-size: 12px; min-height: 18px; }

    /* App Shell */
    #appShell {
      display: none;
      min-height: 100vh;
      min-width: 0;
      max-width: 100%;
      grid-template-columns: 220px minmax(0, 1fr);
    }
    @media (max-width: 860px) {
      #appShell { grid-template-columns: 1fr; }
      aside { position: static !important; height: auto !important; border-right: none !important; border-bottom: 1px solid var(--border); }
    }

    aside {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      background: var(--panel);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      padding: 16px 12px;
    }
    .brand-row {
      display: flex; align-items: center; gap: 9px;
      padding: 4px 8px 16px; border-bottom: 1px solid var(--border); margin-bottom: 12px;
    }
    .brand-title { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
    .brand-ver { font-size: 11px; color: var(--fg-muted); margin-left: auto; }

    .nav-list { display: flex; flex-direction: column; gap: 2px; }
    .nav-item {
      width: 100%; justify-content: flex-start; border: 1px solid transparent; background: transparent;
      color: var(--fg-muted); padding: 7px 10px; border-radius: 6px; font-size: 13px; font-weight: 500;
    }
    .nav-item:hover { background: var(--panel-hover); color: var(--fg); border-color: transparent; }
    .nav-item.active { background: var(--subtle); color: var(--fg); border-color: var(--border); }
    .nav-item svg { width: 15px; height: 15px; stroke-width: 1.7; flex-shrink: 0; }
    .nav-count {
      margin-left: auto; font-size: 11px; color: var(--fg-muted);
      background: var(--bg); border: 1px solid var(--border); border-radius: 99px; padding: 0 6px;
    }

    .aside-foot {
      border-top: 1px solid var(--border); padding-top: 12px;
      display: flex; align-items: center; justify-content: space-between; gap: 4px; flex-wrap: wrap;
    }

    .main-col { display: flex; flex-direction: column; min-width: 0; }
    .topbar {
      position: sticky; top: 0; z-index: 20;
      height: 56px; border-bottom: 1px solid var(--border); background: var(--panel);
      padding: 0 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .topbar-left { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14px; }
    .topbar-right { display: flex; align-items: center; gap: 4px; }
    .sync-time { font-size: 12px; color: var(--fg-muted); margin-right: 8px; }
    .tb-icon-btn {
      display: inline-flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; min-width: 48px; height: 42px; padding: 4px 8px;
      border-radius: 6px; border: 1px solid transparent; background: transparent;
      color: var(--fg-muted); cursor: pointer; transition: background-color 0.15s, color 0.15s, border-color 0.15s;
    }
    .tb-icon-btn:hover { background: var(--panel-hover); color: var(--fg); border-color: var(--border); }
    .tb-icon-btn svg { width: 15px; height: 15px; stroke-width: 1.8; flex-shrink: 0; }
    .tb-lbl { font-size: 10.5px; line-height: 1.1; white-space: nowrap; }

    .workspace { padding: 24px; max-width: 1360px; width: 100%; min-width: 0; overflow-x: clip; }
    .view-pane { display: none; min-width: 0; }
    .view-pane.active { display: block; min-width: 0; max-width: 100%; }

    #noticeBar {
      display: none; padding: 9px 14px; border: 1px solid var(--border);
      background: var(--panel); border-radius: 6px; margin-bottom: 16px; font-size: 12px;
      align-items: center; justify-content: space-between;
    }
    #noticeBar.show { display: flex; }
    #noticeBar.err { border-color: var(--err); color: var(--err); }

    .onboard-banner {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      padding: 14px 18px;
      margin-bottom: 18px;
      background: var(--panel);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    }
    .onboard-banner.show { display: flex; }
    .onboard-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    .onboard-steps { font-size: 12px; color: var(--fg-muted); line-height: 1.6; }
    .onboard-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

    /* Segmented 1px Metric Strip */
    .metric-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      background: var(--border);
      gap: 1px;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 18px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    }
    @media (max-width: 900px) { .metric-strip { grid-template-columns: repeat(2, 1fr); } }
    .metric-cell { background: var(--panel); padding: 15px 18px; }
    .metric-k { font-size: 12px; color: var(--fg-muted); margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
    .metric-v { font-size: 23px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.2; font-variant-numeric: tabular-nums; }
    .metric-s { font-size: 11.5px; color: var(--fg-muted); margin-top: 6px; font-variant-numeric: tabular-nums; }

    /* Overview charts (inline SVG, no external libs) */
    .ov-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
    .seg button { height: 30px; padding: 0 12px; font-size: 12px; border: none; border-radius: 0; background: var(--panel); color: var(--fg-muted); }
    .seg button + button { border-left: 1px solid var(--border); }
    .seg button.active { background: var(--cta-bg); color: var(--cta-fg); }
    .seg-sm button { height: 24px; padding: 0 9px; font-size: 11.5px; }
    .ov-note { font-size: 12px; color: var(--fg-muted); }
    .ov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: stretch; }
    @media (max-width: 900px) { .ov-grid { grid-template-columns: 1fr; } }
    .ov-grid > .panel-box { display: flex; flex-direction: column; }
    .ov-chart { position: relative; flex: 1; padding: 16px 18px; min-height: 210px; display: flex; align-items: center; }
    #ovTrend svg { width: 100%; height: auto; display: block; overflow: visible; }
    #ovDonut svg { flex-shrink: 0; display: block; overflow: visible; }
    .ov-empty { width: 100%; color: var(--fg-muted); font-size: 12px; text-align: center; padding: 52px 0; }
    .ov-donut-wrap { width: 100%; display: flex; align-items: center; gap: 24px; }
    @media (max-width: 560px) { .ov-donut-wrap { flex-direction: column; } }
    .ov-donut-arc { cursor: pointer; transition: stroke-width 0.16s ease, opacity 0.16s ease; }
    .ov-donut-legend { flex: 1; min-width: 0; font-size: 12px; display: grid; gap: 4px; font-variant-numeric: tabular-nums; }
    .ov-dl-row {
      display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; align-items: center; gap: 8px;
      padding: 5px 8px; border-radius: 6px; cursor: pointer; transition: background-color 0.12s ease, opacity 0.16s ease;
    }
    .ov-dl-row:hover, .ov-dl-row.is-hot { background: var(--panel-hover); }
    .ov-dl-nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .ov-dl-req { color: var(--fg-muted); text-align: right; white-space: nowrap; font-size: 11.5px; }
    .ov-dl-tok { color: var(--fg); text-align: right; white-space: nowrap; min-width: 96px; font-weight: 500; }
    .ov-tip {
      position: fixed; z-index: 90; pointer-events: none; opacity: 0;
      background: var(--panel); color: var(--fg); border: 1px solid var(--border-strong);
      border-radius: 8px; padding: 8px 11px; font-size: 11.5px; line-height: 1.45;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14); transition: opacity 0.1s ease;
      font-variant-numeric: tabular-nums; min-width: 150px; max-width: 280px;
    }
    .ov-tip.show { opacity: 1; }
    .ov-tip-hdr { font-weight: 600; margin-bottom: 4px; word-break: break-all; }
    .ov-tip-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .ov-tip-k { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-muted); }
    .ov-sw { width: 9px; height: 9px; border-radius: 2px; flex: none; }
    .ov-legend { font-size: 11.5px; color: var(--fg-muted); display: inline-flex; gap: 14px; align-items: center; }
    .ov-rank { padding: 12px 16px 16px; display: grid; gap: 11px; font-variant-numeric: tabular-nums; }
    .ov-rank-row { display: grid; grid-template-columns: minmax(100px, 170px) 1fr auto; gap: 12px; align-items: center; font-size: 12px; }
    .ov-rank-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .ov-track { height: 7px; background: var(--subtle); border: 1px solid var(--border); border-radius: 99px; overflow: hidden; }
    .ov-fill { height: 100%; background: var(--ok); border-radius: 99px; transition: width 0.25s ease; }

    /* Panels & Tables */
    .panel-box {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 18px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
      min-width: 0;
      max-width: 100%;
    }
    .panel-hdr {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    }
    .panel-hdr h2 { font-size: 13px; font-weight: 600; }
    .panel-hdr p { font-size: 12px; color: var(--fg-muted); }

    .batch-bar {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--subtle);
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    }

    .table-wrap {
      overflow-x: auto;
      overflow-y: hidden;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overscroll-behavior-x: contain;
      isolation: isolate;
    }
    table {
      width: max-content;
      min-width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 12.5px;
    }
    th {
      text-align: left; padding: 9px 11px; font-size: 11px; font-weight: 500;
      color: var(--fg-muted); background: var(--subtle); border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    td {
      padding: 10px 11px; border-bottom: 1px solid var(--border); vertical-align: middle;
      white-space: nowrap; background: var(--panel);
    }
    tr:last-child td { border-bottom: none; }
    tr.row-disabled td:not(.ops-cell) { opacity: 0.52; }
    tr.clickable-row { cursor: pointer; transition: background-color 0.1s; }
    tr.clickable-row:hover td, tr:hover td { background: var(--panel-hover); }
    th.ops-cell, td.ops-cell {
      position: sticky;
      right: 0;
      z-index: 3;
      background: var(--panel);
      border-left: 1px solid var(--border);
      box-shadow: -8px 0 12px -8px rgba(0, 0, 0, 0.18);
    }
    th.ops-cell { z-index: 4; background: var(--subtle); }
    tr:hover td.ops-cell, tr.clickable-row:hover td.ops-cell { background: var(--panel-hover); }
    .ops-stack { display: flex; flex-wrap: nowrap; gap: 4px; width: max-content; }
    .bill-cell, .run-cell { white-space: normal; max-width: 220px; }
    .bill-cell > div, .run-cell > div { white-space: normal; }

    .status-line { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; }
    .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .dot-ok { background: var(--ok); }
    .dot-warn { background: var(--warn); }
    .dot-err { background: var(--err); }
    .dot-off { background: var(--fg-faint); }
    @keyframes pulseOp { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .dot-pulse { background: var(--warn); animation: pulseOp 1.2s infinite; }

    .tag {
      display: inline-block; white-space: nowrap; padding: 2px 7px; font-size: 11px; font-weight: 500;
      border: 1px solid var(--border); border-radius: 4px; color: var(--fg-muted);
      background: var(--subtle);
    }
    .tag-ok { color: var(--ok); border-color: rgba(16,185,129,0.35); }
    .tag-warn { color: var(--warn); border-color: rgba(245,158,11,0.35); }

    .qbar-cell { width: 128px; min-width: 128px; max-width: 128px; }
    .qbar-top { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font-size: 11.5px; margin-bottom: 4px; min-width: 0; }
    .qbar-rem { color: var(--fg-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .qbar-track { height: 5px; background: var(--track); border-radius: 2px; overflow: hidden; }
    .qbar-fill { height: 100%; border-radius: 2px; transition: width 0.25s ease; }
    .bot-stack { width: 128px; max-width: 128px; white-space: normal; }

    .setting-row {
      display: flex; align-items: center; justify-content: space-between; gap: 20px;
      padding: 16px 18px; border-bottom: 1px solid var(--border);
    }
    .setting-row:last-child { border-bottom: none; }
    .setting-info h3 { font-size: 13px; font-weight: 500; margin-bottom: 2px; }
    .setting-info p { font-size: 12px; color: var(--fg-muted); max-width: 640px; }

    .switch { position: relative; display: inline-block; width: 34px; height: 19px; flex-shrink: 0; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; cursor: pointer; inset: 0; background: var(--track);
      border: 1px solid var(--border-strong); border-radius: 99px; transition: 0.15s;
    }
    .slider:before {
      content: ""; position: absolute; height: 13px; width: 13px; left: 2px; bottom: 2px;
      background: var(--fg-muted); border-radius: 50%; transition: 0.15s;
    }
    input:checked + .slider { background: var(--cta-bg); border-color: var(--cta-bg); }
    input:checked + .slider:before { transform: translateX(15px); background: var(--cta-fg); }

    /* Modal */
    .modal-mask {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: none; align-items: center; justify-content: center; padding: 20px; z-index: 60;
    }
    .modal-mask.open { display: flex; }
    .modal-card {
      width: 100%; max-width: 460px; max-height: 90vh; background: var(--panel);
      border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
      display: flex; flex-direction: column;
    }
    .modal-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; flex: 1; }
    .modal-foot {
      padding: 12px 16px; border-top: 1px solid var(--border); background: var(--subtle);
      display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0;
    }
    .ck-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 10px 12px;
      max-height: 290px;
      overflow-y: auto;
      align-content: start;
      background: var(--bg);
    }
    @media (max-width: 640px) { .ck-grid { grid-template-columns: 1fr; } }
    .ck-card {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 8px 10px;
      min-height: 44px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      cursor: pointer;
      min-width: 0;
      transition: border-color 0.12s, background-color 0.12s;
    }
    .ck-card:hover { background: var(--panel-hover); border-color: var(--border-strong); }
    .ck-card.picked { border-color: var(--fg); background: var(--subtle); }
    .ck-card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .ck-card-id { font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ck-card-name { font-size: 11px; color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .preset-pills { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 5px; }
    .field-lbl { font-size: 12px; color: var(--fg-muted); display: block; margin-bottom: 4px; }

    pre.code-block {
      background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      padding: 12px 14px; overflow-x: auto; font-size: 12px; line-height: 1.55; color: var(--fg);
      white-space: pre-wrap; word-break: break-word;
    }

    /* Slide-Over Request Trace Drawer */
    .drawer-mask {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      display: none; justify-content: flex-end; z-index: 55;
    }
    .drawer-mask.open { display: flex; }
    .drawer-panel {
      width: 100%; max-width: 720px; height: 100%; background: var(--panel);
      border-left: 1px solid var(--border); display: flex; flex-direction: column;
    }
    .drawer-hdr {
      padding: 14px 18px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
    }
    .drawer-body { padding: 18px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px; }
    .kv-grid {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
      padding: 12px 14px; background: var(--subtle); border: 1px solid var(--border); border-radius: 6px;
    }
    .kv-item span { display: block; font-size: 11px; color: var(--fg-muted); }
    .kv-item strong { font-size: 12.5px; font-weight: 600; }
  </style>
</head>
<body>

  <!-- 1. Password Login Gate -->
  <div id="loginGate">
    <div class="login-box">
      <div class="login-head" style="justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="login-mark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          </div>
          <h1>CursorProxyAPI Console</h1>
        </div>
        <button type="button" class="btn-xs btn-ghost" id="loginLangBtn">EN</button>
      </div>
      <p class="login-desc">输入管理员访问密码以解锁多账号调度、模型权限、实时日志与额度中心。</p>
      <form class="login-form" id="loginForm">
        <input id="loginPwdInput" type="password" placeholder="管理员密码" autocomplete="current-password" required />
        <div class="login-err" id="loginErrText"></div>
        <button type="submit" class="btn-solid" id="loginSubmitBtn">验证并进入控制台</button>
      </form>
    </div>
  </div>

  <!-- 2. Main Console -->
  <div id="appShell">
    <aside>
      <div>
        <div class="brand-row">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#141417"/><rect x=".75" y=".75" width="30.5" height="30.5" rx="7.25" stroke="currentColor" stroke-opacity=".18"/><polygon points="16,5.5 25,10.7 16,15.9 7,10.7" fill="#ffffff" fill-opacity=".95"/><polygon points="7,10.7 16,15.9 16,26.5 7,21.3" fill="#ffffff" fill-opacity=".35"/><polygon points="25,10.7 25,21.3 16,26.5 16,15.9" fill="#ffffff" fill-opacity=".62"/><path d="M16 15.9L25 10.7M16 15.9V26.5M16 15.9L7 10.7" stroke="#141417" stroke-width="1.1" stroke-linejoin="round"/><circle cx="25" cy="10.7" r="2.1" fill="#10b981" stroke="#141417" stroke-width=".9"/></svg>
          <span class="brand-title">CursorProxyAPI</span>
          <span class="brand-ver mono">v1.0.0</span>
        </div>
        <nav class="nav-list">
          <button class="nav-item active" data-tab="overview">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
            总览监控
          </button>
          <button class="nav-item" data-tab="logs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            实时请求日志
            <span class="nav-count mono" id="navLogCount">0</span>
          </button>
          <button class="nav-item" data-tab="credentials">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            凭证与额度池
          </button>
          <button class="nav-item" data-tab="clientkeys">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            网关子密钥管理
            <span class="nav-count mono" id="navClientKeyCount">1</span>
          </button>
          <button class="nav-item" data-tab="models">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            模型权限管理
            <span class="nav-count mono" id="navModelCount">—</span>
          </button>
          <button class="nav-item" data-tab="routing">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            路由与亲和策略
          </button>
          <button class="nav-item" data-tab="playground">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            在线测试与接入
          </button>
        </nav>
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="topbar-left" id="topbarTitle">总览监控</div>
        <div class="topbar-right">
          <span class="sync-time mono" id="syncTimeLabel">—</span>
          <button class="tb-icon-btn" id="langToggleBtn" type="button" title="切换语言">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
            <span class="tb-lbl">中文</span>
          </button>
          <button class="tb-icon-btn" id="themeToggleBtn" type="button" title="切换主题">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/></svg>
            <span class="tb-lbl">浅色</span>
          </button>
          <button class="tb-icon-btn" id="changePwdBtn" type="button" title="修改管理员密码">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span class="tb-lbl">改密</span>
          </button>
          <button class="tb-icon-btn" id="logoutBtn" type="button" title="退出登录">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span class="tb-lbl">退出</span>
          </button>
        </div>
      </div>

      <div class="workspace">
        <div id="noticeBar"><span id="noticeText"></span><button class="btn-xs btn-ghost" data-click="hideNotice">关闭</button></div>

        <!-- TAB 1: OVERVIEW -->
        <div class="view-pane active" id="pane-overview">
          <div class="onboard-banner" id="onboardBanner">
            <div>
              <div class="onboard-title" id="onboardTitle">2 步快速开始使用</div>
              <div class="onboard-steps" id="onboardSteps">
                ① 点击右侧「+ 添加凭证」填入你的 Cursor <span class="mono">crsr_...</span> 密钥（或使用 SessionToken 一键生成）。<br/>
                ② 在 AI 客户端填入接口地址与 <span class="mono">GATEWAY_TOKEN</span>（或「网关子密钥管理」中自动生成的默认 <span class="mono">sk-cgw-...</span> 密钥）即可直接调用，无需重复建密钥。
              </div>
            </div>
            <div class="onboard-actions">
              <button class="btn-solid" data-open-add-modal>+ 添加凭证</button>
              <button type="button" id="onboardToKeysBtn">查看调用密钥 →</button>
            </div>
          </div>

          <div class="ov-bar">
            <div class="seg" id="ovRangeSeg">
              <button class="active" data-click="setOvRange" data-arg="today">今天</button>
              <button data-click="setOvRange" data-arg="7d">近 7 天</button>
              <button data-click="setOvRange" data-arg="30d">近 30 天</button>
            </div>
            <span class="ov-note" id="ovNote">统计仅记录模型、子密钥、客户端 IP、账号与 token 数，不保存任何对话内容</span>
          </div>

          <div class="metric-strip">
            <div class="metric-cell">
              <div class="metric-k"><span>请求数</span><span class="mono" id="ovErrTag">错误 0</span></div>
              <div class="metric-v" id="ovReq">0</div>
              <div class="metric-s" id="ovReqSub">成功率 —</div>
            </div>
            <div class="metric-cell">
              <div class="metric-k"><span>Token 总量</span></div>
              <div class="metric-v" id="ovTok">0</div>
              <div class="metric-s" id="ovTokSub">输入 0 · 缓存 0 · 输出 0</div>
            </div>
            <div class="metric-cell">
              <div class="metric-k"><span>缓存命中率</span></div>
              <div class="metric-v" id="ovCache">0%</div>
              <div class="metric-s" id="ovCacheSub">缓存读取占输入侧比例</div>
            </div>
            <div class="metric-cell">
              <div class="metric-k"><span>可用账号</span><span class="mono" id="mStrategyTag">quota-aware</span></div>
              <div class="metric-v" id="mActiveKeys">0 / 0</div>
              <div class="metric-s" id="mInflightSub">活跃并发流: 0 · 自动熔断: 0</div>
            </div>
          </div>

          <div class="ov-grid">
            <div class="panel-box">
              <div class="panel-hdr">
                <h2 id="ovDistTitle">模型分布（按 Token）</h2>
                <div class="seg seg-sm" id="ovDistSeg">
                  <button class="active" data-click="setOvDist" data-arg="model">按模型</button>
                  <button data-click="setOvDist" data-arg="account">按账号</button>
                  <button data-click="setOvDist" data-arg="key">按子密钥</button>
                </div>
              </div>
              <div class="ov-chart" id="ovDonut"></div>
            </div>
            <div class="panel-box">
              <div class="panel-hdr"><h2>Token 趋势</h2><span class="ov-legend" id="ovTrendLegend"></span></div>
              <div class="ov-chart" id="ovTrend"></div>
            </div>
          </div>

          <div class="panel-box">
            <div class="panel-hdr">
              <div>
                <h2>账号池实时额度速览 (Auto 池 & 高级 API 池)</h2>
                <p>点击任意账号行可直接跳转查看该账号的专属实时请求日志</p>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button data-sync-quota>同步最新额度</button>
                <button class="btn-solid" data-open-add-modal>+ 添加凭证</button>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>账号标识 / 邮箱</th>
                    <th>套餐</th>
                    <th>Auto / Grok 已用额度</th>
                    <th>高级 API 已用额度</th>
                    <th>Bot 额度</th>
                    <th>总额度池 / 按需支出</th>
                    <th>粘性会话 / 调度</th>
                  </tr>
                </thead>
                <tbody id="overviewAccountsBody"></tbody>
              </table>
            </div>
          </div>

          <div class="panel-box">
            <div class="panel-hdr">
              <div><h2>最近请求</h2><p id="ovRecentSub">仅元数据，默认展示最近 10 条（不保存任何对话内容）</p></div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <select id="ovFilterIp" data-change="renderOvRecent"><option value="">全部 IP</option></select>
                <select id="ovFilterKey" data-change="renderOvRecent"><option value="">全部子密钥</option></select>
                <select id="ovFilterClient" data-change="renderOvRecent"><option value="">全部客户端</option></select>
                <button id="ovViewAllLogsBtn" type="button">查看全部日志 →</button>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>模型</th>
                    <th>子密钥</th>
                    <th>客户端 IP</th>
                    <th>客户端</th>
                    <th>账号</th>
                    <th>状态</th>
                    <th>耗时</th>
                    <th>输入 / 缓存 / 输出</th>
                  </tr>
                </thead>
                <tbody id="ovRecentBody"></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- TAB 2: REAL-TIME REQUEST LOGS -->
        <div class="view-pane" id="pane-logs">
          <div class="panel-box">
            <div class="panel-hdr">
              <div>
                <h2>实时请求日志（仅元数据，点击任意行查看复用诊断）</h2>
                <p>网关不保存任何对话内容：只记录模型、账号、耗时、token、字符数与单向指纹；「工具热续跑」仅发送新增工具结果增量</p>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="logAccountFilter" style="min-width:165px;">
                  <option value="all">全部执行账号</option>
                </select>
                <select id="logFilterSelect">
                  <option value="all">全部请求类型</option>
                  <option value="running">生成中</option>
                  <option value="tools">含工具调用</option>
                  <option value="thinking">含思考链</option>
                  <option value="error">异常报错</option>
                </select>
                <input id="logSearchInput" type="text" placeholder="搜模型 / 客户端 / UA..." style="width:185px;" />
                <button id="livePollLogsBtn">实时刷新(3s): 开</button>
                <button id="manualRefreshLogsBtn">刷新</button>
                <button class="btn-danger" id="clearLogsBtn">清空</button>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>状态</th>
                    <th>模型 / 协议</th>
                    <th>执行账号 / 模式</th>
                    <th>输出与上下文规模</th>
                    <th>首包 / 总耗时</th>
                    <th>新发 / 缓存 / 输出</th>
                  </tr>
                </thead>
                <tbody id="logsTableBody"></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- TAB 3: CREDENTIALS -->
        <div class="view-pane" id="pane-credentials">
          <div class="panel-box">
            <div class="panel-hdr">
              <div>
                <h2>Cursor API Key 凭证管理</h2>
                <p>支持多账号自动轮询、限流指数退避冷却、额度归零自动熔断关停与热启停</p>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button data-sync-quota>同步最新额度</button>
                <button class="btn-solid" data-open-add-modal>+ 添加凭证</button>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>启用</th>
                    <th>备注 / 掩码凭证</th>
                    <th>绑定账号与周期</th>
                    <th>Auto 池已用</th>
                    <th>API 池已用</th>
                    <th>Bot 额度</th>
                    <th>账单详情</th>
                    <th>运行状态与统计</th>
                    <th class="ops-cell">操作</th>
                  </tr>
                </thead>
                <tbody id="credTableBody"></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- TAB 3b: CLIENT GATEWAY SUB-KEYS -->
        <div class="view-pane" id="pane-clientkeys">
          <div class="panel-box">
            <div class="panel-hdr">
              <div>
                <h2>网关对外调用密钥管理 (Client Gateway Sub-Keys)</h2>
                <p>支持创建多把网关子密钥分发给不同客户端或同事，每把密钥可独立勾选允许访问的模型白名单并统计用量</p>
              </div>
              <button class="btn-solid" id="openCreateCkModalBtn">+ 创建网关子密钥</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style="width:65px;">启用</th>
                    <th>密钥名称</th>
                    <th>Token (点击安全复制)</th>
                    <th>可访问模型范围</th>
                    <th>次数限制 / 有效期</th>
                    <th>累计 Token / 最近调用</th>
                    <th class="ops-cell">操作</th>
                  </tr>
                </thead>
                <tbody id="clientKeysBody"></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- TAB 4: MODEL ACCESS CONTROL -->
        <div class="view-pane" id="pane-models">
          <div class="panel-box">
            <div class="panel-hdr">
              <div>
                <h2>对外开放模型列表与启停管理 (Model Access Control)</h2>
                <p>参数传法：① 模型名后缀如 <span class="mono">grok-4.6[effort=high,fast=true]</span>、<span class="mono">gpt-5.4[context=1m]</span>；② 标准请求体 <span class="mono">reasoning_effort</span> / Claude <span class="mono">thinking</span>（网关会自动按各模型 Schema 转换键名与取值）</p>
              </div>
              <button id="refreshModelsBtn">刷新上游模型目录</button>
            </div>
            <div class="batch-bar">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <input id="modelSearchInput" type="text" placeholder="搜索模型 ID 或名称..." style="width:240px;" />
                <select id="modelPoolFilter">
                  <option value="all">全部额度池</option>
                  <option value="auto">仅 Auto 池模型 (Grok/Composer/Auto)</option>
                  <option value="api">仅 高级 API 池模型 (Claude/GPT/Gemini)</option>
                  <option value="enabled">仅已启用</option>
                  <option value="disabled">仅已禁用</option>
                </select>
                <span style="font-size:12px;color:var(--fg-muted);" id="modelSelSummary">已勾选 0 项</span>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button id="batchEnableBtn">批量启用勾选</button>
                <button id="batchDisableBtn">批量禁用勾选</button>
                <button id="batchWhitelistBtn" title="仅保留当前勾选的模型启用，其余全部禁用">仅启用勾选项(白名单)</button>
                <button class="btn-danger" id="batchDisableApiPoolBtn" title="一键禁用所有消耗外部 API 池的 Claude/GPT/Gemini 模型">一键禁用全部 API 池模型</button>
                <button id="batchEnableAllBtn">全部恢复启用</button>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style="width:36px;"><input type="checkbox" id="modelSelectAllCb" title="全选当前筛选列表" /></th>
                    <th style="width:70px;">对外状态</th>
                    <th>模型 ID (Model ID)</th>
                    <th>显示名称</th>
                    <th>所属扣费池</th>
                    <th>支持调节参数</th>
                  </tr>
                </thead>
                <tbody id="modelsManageBody">
                  <tr><td colspan="6" style="text-align:center;color:var(--fg-muted);padding:24px;">点击左侧菜单自动加载实时模型目录...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- TAB 5: ROUTING & AFFINITY -->
        <div class="view-pane" id="pane-routing">
          <div class="panel-box">
            <div class="panel-hdr">
              <div>
                <h2>多账号调度、亲和性与熔断策略</h2>
                <p>对齐 CPA 生产级路由机制，修改后立即生效并自动持久化写回服务器 .env</p>
              </div>
              <button class="btn-solid" id="saveRoutingBtn">保存路由配置</button>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <h3>负载均衡算法 (Load Balancing Strategy)</h3>
                <p>Quota-Aware 会识别请求模型所属额度池（Auto/Grok 池 vs Claude/GPT API 池），优先分配给仍有余量且当前活跃并发最少的账号。</p>
              </div>
              <select id="cfgLbStrategy" style="min-width: 240px;">
                <option value="quota-aware">Quota-Aware (余量感知 + 最少并发)</option>
                <option value="least-busy">Least-Busy (最少活跃并发优先)</option>
                <option value="round-robin">Round-Robin (均匀轮询)</option>
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <h3>会话粘性亲和 (Sticky Session Affinity)</h3>
                <p>开启后，同一对话窗口在有效期内始终锁定同一健康账号执行，防止跨号跳跃；若原账号耗尽或限流则自动漂移至健康账号。</p>
              </div>
              <div style="display:flex;align-items:center;gap:12px;">
                <span style="font-size:12px;color:var(--fg-muted);">TTL(秒):</span>
                <input id="cfgAffinityTtl" type="number" min="60" max="86400" style="width:90px;" class="mono" />
                <label class="switch"><input type="checkbox" id="cfgAffinityEnabled" /><span class="slider"></span></label>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <h3>账号没钱 / 鉴权失效自动熔断关停 (Auto-Disable on Exhaustion)</h3>
                <p>当 A 账号返回额度耗尽、双池余量均归零或 401 失效时，当场无缝切流至 B 账号完成回复，并自动关停 A 账号（下个周期自动唤醒）。</p>
              </div>
              <label class="switch"><input type="checkbox" id="cfgAutoDisable" /><span class="slider"></span></label>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <h3>允许 Cursor 云端联网搜索与抓取 (ALLOW_NATIVE_WEB_TOOLS)</h3>
                <p>默认关闭。开启后允许客户端通过 web_search / web_fetch 触发 Cursor 云端联网能力（热更新即时生效，仅建议单人可信环境开启）。</p>
              </div>
              <label class="switch"><input type="checkbox" id="cfgAllowNativeWebTools" /><span class="slider"></span></label>
            </div>
          </div>

          <div class="panel-box">
            <div class="panel-hdr">
              <div>
                <h2>当前活跃粘性会话路由表</h2>
                <p>展示会话指纹与上游账号的实时绑定关系</p>
              </div>
              <button id="clearAffinityBtn">清空亲和绑定</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>会话指纹 (Conversation Key)</th>
                    <th>锁定账号槽位</th>
                    <th>亲和命中次数</th>
                    <th>最近活跃</th>
                    <th>剩余有效期</th>
                  </tr>
                </thead>
                <tbody id="affinityTableBody"></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- TAB 6: PLAYGROUND & ENDPOINTS -->
        <div class="view-pane" id="pane-playground">
          <div class="panel-box">
            <div class="panel-hdr">
              <div>
                <h2>在线拨测台 (Live Request Tester)</h2>
                <p>发送测试消息后，可切到左侧「实时请求日志」查看该请求的执行模式、耗时与 token</p>
              </div>
            </div>
            <div style="padding:16px;display:flex;flex-direction:column;gap:12px;">
              <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <select id="pgModel" style="min-width:240px;" class="mono">
                  <option value="grok-4.6[fast=true,effort=low]">grok-4.6[fast=true,effort=low]</option>
                  <option value="grok-4.6[effort=high]">grok-4.6[effort=high]</option>
                  <option value="grok-4.7[reasoning_effort=high]">grok-4.7[reasoning_effort=high]</option>
                  <option value="auto">auto</option>
                  <option value="composer-2.5">composer-2.5</option>
                </select>
                <input id="pgPrompt" type="text" value="请先思考一下：为什么 0.1 + 0.2 在浮点数里不等于 0.3？用一句话总结。" style="flex:1;min-width:240px;" />
                <button class="btn-solid" id="pgSendBtn">发送测试</button>
              </div>
              <pre class="code-block mono" id="pgOutput" style="min-height:96px;">点击「发送测试」查看实时返回结果与思考链...</pre>
            </div>
          </div>

          <div class="panel-box">
            <div class="panel-hdr"><h2>标准协议接入端点</h2></div>
            <div style="padding:16px;display:grid;gap:14px;">
              <div>
                <span class="field-lbl">OpenAI 兼容客户端 (Kilo / Kiro / Roo Code / Cline / NextChat)</span>
                <pre class="code-block mono" id="snippetOpenai"></pre>
              </div>
              <div>
                <span class="field-lbl">Anthropic Claude 原生协议 (Claude Code CLI / @ai-sdk/anthropic)</span>
                <pre class="code-block mono" id="snippetClaude"></pre>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- Slide-Over Request Trace Inspector Drawer -->
  <div class="drawer-mask" id="traceDrawer" role="dialog" aria-modal="true" aria-labelledby="drTitle" data-click-self="closeTraceDrawer">
    <div class="drawer-panel">
      <div class="drawer-hdr">
        <div>
          <div style="font-weight:600;font-size:14px;" id="drTitle">请求诊断（仅元数据）</div>
          <div class="mono" style="font-size:11px;color:var(--fg-muted);" id="drSubtitle">—</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn-xs" id="drRefreshBtn">刷新详情</button>
          <button class="btn-xs btn-ghost" aria-label="关闭诊断抽屉" data-click="closeTraceDrawer">✕ 关闭</button>
        </div>
      </div>
      <div class="drawer-body" id="drBody"></div>
    </div>
  </div>

  <!-- Add Key Modal: import upstream crsr_ API keys -->
  <div class="modal-mask" id="addModal" role="dialog" aria-modal="true" aria-labelledby="addModalTitle" data-click-self="closeAddModal">
    <div class="modal-card" style="max-width: 540px;">
      <div class="panel-hdr">
        <h2 id="addModalTitle">添加 Cursor 账号凭证</h2>
        <button class="btn-xs btn-ghost" aria-label="关闭弹窗" data-click="closeAddModal">✕</button>
      </div>
      <div class="modal-body" id="addBodyCrsr">
        <div>
          <label class="field-lbl">API Key (支持每行粘贴一把 crsr_... 批量导入)</label>
          <textarea id="modalKeysInput" rows="4" class="mono" style="width:100%;" placeholder="crsr_xxxxxxxxxxxxxxxxxxxx"></textarea>
        </div>
        <div style="display:flex;gap:10px;">
          <div style="flex:1;">
            <label class="field-lbl">备注名称 (可选，如：主力 Pro 号)</label>
            <input id="modalLabelInput" type="text" style="width:100%;" placeholder="例如：主力 Pro 2号" />
          </div>
          <div>
            <label class="field-lbl">初始状态</label>
            <select id="modalEnabledSelect">
              <option value="true">立即启用负载</option>
              <option value="false">停用封存备用</option>
            </select>
          </div>
        </div>
      </div>
      <div class="modal-body" id="addBodySession" style="border-top:1px solid var(--border);">
        <div>
          <label class="field-lbl">或用 SessionToken 导入（网页 Cookie WorkosCursorSessionToken 的值，或 eyJ... JWT）</label>
          <textarea id="modalSessionInput" rows="2" class="mono" style="width:100%;" placeholder="user_01...%3A%3AeyJ..." autocomplete="off" spellcheck="false"></textarea>
          <div style="font-size:11px;color:var(--fg-muted);margin-top:4px;">SessionToken 仅用于本次请求，不会保存、不会写入日志。Cursor 只会返回已有 Key 的掩码，无法直接导入；需要时会为该账号新建一把专用 Key。</div>
        </div>
        <div id="sessionPreview" style="display:none;font-size:12px;"></div>
        <div style="display:flex;gap:8px;">
          <button id="sessionCheckBtn">检查该账号已有 Key</button>
          <button class="btn-solid" id="sessionCreateBtn" style="display:none;">确认创建新 Key 并导入</button>
        </div>
      </div>
      <div class="modal-foot" id="addFootCrsr">
        <button data-click="closeAddModal">取消</button>
        <button class="btn-solid" id="confirmAddKeyBtn">确认导入并同步额度</button>
      </div>
    </div>
  </div>

  <!-- Create / Edit Client Gateway Sub-Key Modal -->
  <div class="modal-mask" id="clientKeyModal" role="dialog" aria-modal="true" aria-labelledby="ckModalTitle" data-click-self="closeCkModal">
    <div class="modal-card" style="max-width: 720px;">
      <div class="panel-hdr" style="flex-shrink:0;">
        <h2 id="ckModalTitle">创建网关子密钥</h2>
        <button class="btn-xs btn-ghost" aria-label="关闭弹窗" data-click="closeCkModal">✕</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">
          <div>
            <label class="field-lbl">密钥名称备注</label>
            <input id="ckNameInput" type="text" style="width:100%;" placeholder="例如：分享给前端组 Key / 临时测试 Key" />
          </div>
          <div id="ckTokenFieldWrap">
            <label class="field-lbl">自定义 Token (留空自动生成 sk-cgw-...)</label>
            <input id="ckTokenInput" type="text" class="mono" style="width:100%;" placeholder="留空自动生成高强度随机密钥" />
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;padding:12px;background:var(--subtle);border:1px solid var(--border);border-radius:6px;">
          <div>
            <label class="field-lbl">最大调用次数限制 (留空或 0 = 无限制)</label>
            <input id="ckMaxReqInput" type="number" min="0" step="1" class="mono" style="width:100%;" placeholder="无次数限制" />
            <div class="preset-pills">
              <button type="button" class="btn-xs" data-click="setCkMaxReq" data-arg="">无限制</button>
              <button type="button" class="btn-xs" data-click="setCkMaxReq" data-arg="50">50 次</button>
              <button type="button" class="btn-xs" data-click="setCkMaxReq" data-arg="200">200 次</button>
              <button type="button" class="btn-xs" data-click="setCkMaxReq" data-arg="1000">1,000 次</button>
            </div>
          </div>
          <div>
            <label class="field-lbl">最大并发请求数 (留空或 0 = 不限制)</label>
            <input id="ckMaxConcInput" type="number" min="0" step="1" class="mono" style="width:100%;" placeholder="不限制并发" />
            <div class="preset-pills">
              <button type="button" class="btn-xs" data-click="setCkMaxConc" data-arg="">不限制</button>
              <button type="button" class="btn-xs" data-click="setCkMaxConc" data-arg="3">3</button>
              <button type="button" class="btn-xs" data-click="setCkMaxConc" data-arg="8">8</button>
              <button type="button" class="btn-xs" data-click="setCkMaxConc" data-arg="16">16</button>
            </div>
          </div>
          <div>
            <label class="field-lbl">到期失效时间 (留空 = 永不过期)</label>
            <input id="ckExpiresInput" type="datetime-local" class="mono" style="width:100%;" />
            <div class="preset-pills">
              <button type="button" class="btn-xs" data-click="setCkExpDays" data-arg="0">永不过期</button>
              <button type="button" class="btn-xs" data-click="setCkExpDays" data-arg="1">+1 天</button>
              <button type="button" class="btn-xs" data-click="setCkExpDays" data-arg="7">+7 天</button>
              <button type="button" class="btn-xs" data-click="setCkExpDays" data-arg="30">+30 天</button>
            </div>
          </div>
        </div>

        <div>
          <label class="field-lbl">模型访问权限策略</label>
          <select id="ckScopeSelect" style="width:100%;">
            <option value="all">允许访问全部全局已启用模型 (无单独模型限制)</option>
            <option value="custom">仅允许访问下方勾选的指定模型 (自定义模型白名单)</option>
          </select>
        </div>

        <div id="ckModelsPickerWrap" style="display:none;border:1px solid var(--border);border-radius:6px;overflow:hidden;">
          <div style="padding:9px 12px;background:var(--subtle);border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <input id="ckModelSearch" type="text" placeholder="搜索模型 ID 或名称..." style="flex:1;min-width:140px;padding:5px 9px;font-size:12px;" />
            <span class="mono" style="font-size:11.5px;color:var(--fg-muted);margin:0 4px;" id="ckPickedCountLabel">已选 0 项</span>
            <button type="button" class="btn-xs" id="ckPickAutoBtn">仅勾 Auto 免费池</button>
            <button type="button" class="btn-xs" id="ckPickGrokBtn">仅勾 Grok</button>
            <button type="button" class="btn-xs" id="ckPickAllBtn">全选</button>
            <button type="button" class="btn-xs" id="ckPickNoneBtn">清空</button>
          </div>
          <div id="ckModelsChecklist" class="ck-grid"></div>
        </div>
      </div>
      <div class="modal-foot">
        <button data-click="closeCkModal">取消</button>
        <button class="btn-solid" id="saveCkModalBtn">保存网关密钥配置</button>
      </div>
    </div>
  </div>

  <div id="cSelMenu" class="c-sel-menu" role="listbox"></div>
  <div id="ovTip" class="ov-tip" aria-hidden="true"></div>

  <script nonce="${nonce}">
    const DASH_PATH = ${serializedDashPath};
    const cleanPathname = location.pathname.replace(/\\/+$/, "");
    const basePath = cleanPathname.endsWith(DASH_PATH)
      ? cleanPathname.slice(0, cleanPathname.length - DASH_PATH.length)
      : cleanPathname.replace(/\\/(dashboard|status)$/, "");
    const THEME_KEY = "cgw_ui_theme";
    const LANG_KEY = "cgw_ui_lang";
    let currentLang = localStorage.getItem(LANG_KEY) || ((navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en");
    let lastConsoleData = null;
    let lastOverviewData = null;
    let sessionBearer = sessionStorage.getItem("cgw_session_bearer") || "";
    let activeTab = "overview";
    let poolSlotsCache = [];
    let logsCache = [];
    let liveLogsPoll = true;
    let openTraceId = null;
    let openTraceDetail = null;

    let modelsCatalogCache = [];
    const selectedModelIds = new Set();
    let clientKeysCache = [];
    let editingCkId = null;
    const ckPickedModels = new Set();

    const $ = (id) => document.getElementById(id);

    const EN_STATIC = {
      "允许 Cursor 云端联网搜索与抓取 (ALLOW_NATIVE_WEB_TOOLS)": "Allow Cursor Cloud Web Search & Fetch (ALLOW_NATIVE_WEB_TOOLS)",
      "默认关闭。开启后允许客户端通过 web_search / web_fetch 触发 Cursor 云端联网能力（热更新即时生效，仅建议单人可信环境开启）。": "Disabled by default. Allows clients to trigger Cursor cloud web search/fetch via web_search / web_fetch (hot-reloaded; only recommended for trusted single-user environments).",
      "全量模型权限总表": "Full Model Access Matrix",
      "一键切换模型启用状态，或使用批量操作进行白名单管控": "Toggle individual model availability or batch-manage allowlists",
      "当前内存中会话哈希与上游账号绑定映射": "Live in-memory mapping between conversation hashes and upstream accounts",
      "暂无活跃的粘性会话（请求发起后会自动在此建立绑定）": "No active sticky sessions (bindings are established automatically upon request)",
      "展示会话指纹与上游账号的实时绑定关系": "Live mapping between conversation hashes and upstream account slots",
      "多账号调度、亲和性与熔断策略": "Routing, Sticky Affinity & Circuit Breakers",
      "对齐 CPA 生产级路由机制，修改后立即生效并自动持久化写回服务器 .env": "Changes take effect immediately and persist to .env",
      "保存路由配置": "Save Routing",

      "输入管理员访问密码以解锁多账号调度、模型权限、实时日志与额度中心。": "Enter the admin password to unlock account pool routing, model access, live logs, and quota telemetry.",
      "管理员密码": "Admin password",
      "验证并进入控制台": "Sign In to Console",
      "总览监控": "Overview",
      "实时请求日志": "Request Logs",
      "凭证与额度池": "Credentials & Quotas",
      "网关子密钥管理": "Client Sub-Keys",
      "模型权限管理": "Model Access",
      "路由与亲和策略": "Routing & Affinity",
      "在线测试与接入": "Playground & Setup",
      "改密": "Password",
      "退出": "Sign Out",
      "同步最新额度": "Sync Quotas",
      "+ 添加凭证": "+ Add Key",
      "关闭": "Close",
      "今天": "Today",
      "近 7 天": "Last 7 Days",
      "近 30 天": "Last 30 Days",
      "统计仅记录模型、子密钥、客户端 IP、账号与 token 数，不保存任何对话内容": "Metadata only (model, sub-key, client IP, account, token counts). Conversation content is never stored.",
      "请求数": "Requests",
      "错误 0": "Errors 0",
      "成功率 —": "Success Rate —",
      "Token 总量": "Total Tokens",
      "输入 0 · 缓存 0 · 输出 0": "In 0 · Cache 0 · Out 0",
      "缓存命中率": "Cache Hit Rate",
      "缓存读取占输入侧比例": "Cached reads as share of input",
      "可用账号": "Active Accounts",
      "活跃并发流: 0 · 自动熔断: 0": "In-flight: 0 · Auto-tripped: 0",
      "模型分布（按 Token）": "Model Breakdown (by Tokens)",
      "Token 趋势": "Token Trend",
      "2 步快速开始使用": "Quick Start in 2 Steps",
      "查看调用密钥 →": "View API Keys →",
      "按模型": "Models",
      "按账号": "Accounts",
      "按子密钥": "Sub-Keys",
      "查看全部日志 →": "All Logs →",
      "子密钥消耗 Top": "Top Sub-Keys",
      "账号池实时额度速览 (Auto 池 & 高级 API 池)": "Account Pool Quota Snapshot (Auto & Premium API Pools)",
      "点击任意账号行可直接跳转查看该账号的专属实时请求日志": "Click any account row to filter live request logs for that account",
      "状态": "Status",
      "账号标识 / 邮箱": "Account / Email",
      "套餐": "Plan",
      "Auto / Grok 已用额度": "Auto / Grok Used",
      "高级 API 已用额度": "Premium API Used",
      "Bot 额度": "Bot Quota",
      "总额度池 / 按需支出": "Included / On-Demand",
      "粘性会话 / 调度": "Sticky / Dispatched",
      "最近请求": "Recent Requests",
      "仅元数据，网关不保存任何对话内容": "Metadata only; conversation text is never retained",
      "全部 IP": "All IPs",
      "全部子密钥": "All Sub-Keys",
      "全部客户端": "All Clients",
      "时间": "Time",
      "模型": "Model",
      "子密钥": "Sub-Key",
      "客户端 IP": "Client IP",
      "客户端": "Client",
      "账号": "Account",
      "耗时": "Duration",
      "输入 / 缓存 / 输出": "In / Cache / Out",
      "实时请求日志（仅元数据，点击任意行查看复用诊断）": "Live Request Logs (metadata only; click a row for trace diagnostics)",
      "网关不保存任何对话内容：只记录模型、账号、耗时、token、字符数与单向指纹；「工具热续跑」仅发送新增工具结果增量": "No conversation text is saved: only model, account, latency, tokens, char counts, and one-way hashes.",
      "全部执行账号": "All Accounts",
      "全部请求类型": "All Types",
      "生成中": "Running",
      "含工具调用": "With Tools",
      "含思考链": "With Thinking",
      "异常报错": "Errors",
      "搜模型 / 客户端 / UA...": "Search model / client / UA...",
      "实时刷新(3s): 开": "Live Poll (3s): ON",
      "刷新": "Refresh",
      "清空": "Clear",
      "模型 / 协议": "Model / Protocol",
      "执行账号 / 模式": "Account / Mode",
      "输出与上下文规模": "Output & Context Size",
      "首包 / 总耗时": "TTFT / Total",
      "新发 / 缓存 / 输出": "In / Cache / Out",
      "Cursor API Key 凭证管理": "Cursor API Key Pool",
      "支持多账号自动轮询、限流指数退避冷却、额度归零自动熔断关停与热启停": "Multi-account load balancing, rate-limit cooldowns, quota auto-circuit-breaker, and hot toggling",
      "启用": "Enabled",
      "备注 / 掩码凭证": "Label / Masked Key",
      "绑定账号与周期": "Account & Billing Cycle",
      "Auto 池已用": "Auto Pool Used",
      "API 池已用": "API Pool Used",
      "账单详情": "Billing",
      "运行状态与统计": "Runtime Status & Stats",
      "操作": "Actions",
      "网关对外调用密钥管理 (Client Gateway Sub-Keys)": "Client Gateway Sub-Keys",
      "支持创建多把网关子密钥分发给不同客户端或同事，每把密钥可独立勾选允许访问的模型白名单并统计用量": "Issue client sub-keys with independent model allowlists, request/concurrency caps, and expiration",
      "+ 创建网关子密钥": "+ Create Sub-Key",
      "密钥名称": "Name",
      "Token (点击安全复制)": "Token (Click to Copy)",
      "可访问模型范围": "Allowed Models",
      "次数限制 / 有效期": "Quota / Expiry",
      "累计 Token / 最近调用": "Tokens / Last Used",
      "对外开放模型列表与启停管理 (Model Access Control)": "Model Access Control",
      "刷新上游模型目录": "Refresh Catalog",
      "搜索模型 ID 或名称...": "Search model ID or name (e.g. grok, claude)...",
      "全部额度池": "All Pools",
      "仅 Auto 池模型 (Grok/Composer/Auto)": "Auto Pool Only (Grok/Composer/Auto)",
      "仅 高级 API 池模型 (Claude/GPT/Gemini)": "Premium API Pool Only (Claude/GPT/Gemini)",
      "仅已启用": "Enabled Only",
      "仅已禁用": "Disabled Only",
      "已勾选 0 项": "0 selected",
      "批量启用勾选": "Enable Selected",
      "批量禁用勾选": "Disable Selected",
      "仅启用勾选项(白名单)": "Whitelist Selected",
      "仅保留当前勾选的模型启用，其余全部禁用": "Keep only selected models enabled and disable all others",
      "一键禁用全部 API 池模型": "Disable All API Pool",
      "一键禁用所有消耗外部 API 池的 Claude/GPT/Gemini 模型": "Disable all Claude/GPT/Gemini models that consume the Premium API pool",
      "全部恢复启用": "Enable All",
      "全选当前筛选列表": "Select all filtered models",
      "对外状态": "Enabled",
      "模型 ID (Model ID)": "Model ID",
      "显示名称": "Display Name",
      "所属扣费池": "Quota Pool",
      "支持调节参数": "Supported Params",
      "点击左侧菜单自动加载实时模型目录...": "Loading live model catalog...",
      "多账号调度、亲和性与熔断策略": "Routing, Sticky Affinity & Circuit Breaker",
      "对齐 CPA 生产级路由机制，修改后立即生效并自动持久化写回服务器 .env": "Changes take effect immediately and persist to .env",
      "保存路由配置": "Save Routing",
      "负载均衡算法 (Load Balancing Strategy)": "Load Balancing Strategy",
      "Quota-Aware 会识别请求模型所属额度池（Auto/Grok 池 vs Claude/GPT API 池），优先分配给仍有余量且当前活跃并发最少的账号。": "Quota-Aware inspects the target pool (Auto vs API) and picks the healthiest account with remaining quota and lowest concurrency.",
      "Quota-Aware (余量感知 + 最少并发)": "Quota-Aware (Balance + Least Busy)",
      "Least-Busy (最少活跃并发优先)": "Least-Busy (Lowest In-Flight)",
      "Round-Robin (均匀轮询)": "Round-Robin",
      "会话粘性亲和 (Sticky Session Affinity)": "Sticky Session Affinity",
      "开启后，同一对话窗口在有效期内始终锁定同一健康账号执行，防止跨号跳跃；若原账号耗尽或限流则自动漂移至健康账号。": "Keeps multi-turn conversations pinned to the same healthy account within TTL; fails over automatically on exhaustion or 429.",
      "TTL(秒):": "TTL (s):",
      "账号没钱 / 鉴权失效自动熔断关停 (Auto-Disable on Exhaustion)": "Auto-Disable on Exhaustion / 401",
      "当 A 账号返回额度耗尽、双池余量均归零或 401 失效时，当场无缝切流至 B 账号完成回复，并自动关停 A 账号（下个周期自动唤醒）。": "Fails over mid-request when an account runs out of quota or returns 401, and disables it until billing reset.",
      "当前活跃粘性会话路由表": "Active Sticky Session Bindings",
      "展示会话指纹与上游账号的实时绑定关系": "Live mapping between conversation hashes and upstream account slots",
      "清空亲和绑定": "Clear Bindings",
      "会话指纹 (Conversation Key)": "Conversation Key",
      "锁定账号槽位": "Pinned Account Slot",
      "亲和命中次数": "Affinity Hits",
      "最近活跃": "Last Active",
      "剩余有效期": "Remaining TTL",
      "在线拨测台 (Live Request Tester)": "Live Request Playground",
      "发送测试消息后，可切到左侧「实时请求日志」查看该请求的执行模式、耗时与 token": "Send a test prompt, then inspect its execution mode, TTFT, and tokens in Request Logs",
      "发送测试": "Send Test",
      "点击「发送测试」查看实时返回结果与思考链...": "Click Send Test to inspect live response and reasoning...",
      "标准协议接入端点": "Client Integration Endpoints",
      "OpenAI 兼容客户端 (Kilo / Kiro / Roo Code / Cline / NextChat)": "OpenAI-Compatible Clients (Kilo / Roo Code / Cline / Codex / NextChat)",
      "Anthropic Claude 原生协议 (Claude Code CLI / @ai-sdk/anthropic)": "Anthropic Claude Native Clients (Claude Code CLI / @ai-sdk/anthropic)",
      "请求诊断（仅元数据）": "Trace Diagnostics (Metadata Only)",
      "刷新详情": "Refresh",
      "✕ 关闭": "✕ Close",
      "关闭诊断抽屉": "Close diagnostics drawer",
      "添加 Cursor 账号凭证": "Add Cursor API Credentials",
      "关闭弹窗": "Close modal",
      "API Key (支持每行粘贴一把 crsr_... 批量导入)": "API Key(s) (paste one crsr_... key per line)",
      "备注名称 (可选，如：主力 Pro 号)": "Label (optional, e.g. Primary Pro)",
      "例如：主力 Pro 2号": "e.g. Primary Pro #2",
      "初始状态": "Initial State",
      "立即启用负载": "Enabled (Active)",
      "停用封存备用": "Disabled (Standby)",
      "或用 SessionToken 导入（网页 Cookie WorkosCursorSessionToken 的值，或 eyJ... JWT）": "Or import via SessionToken (WorkosCursorSessionToken cookie or eyJ... JWT)",
      "SessionToken 仅用于本次请求，不会保存、不会写入日志。Cursor 只会返回已有 Key 的掩码，无法直接导入；需要时会为该账号新建一把专用 Key。": "SessionToken is used only for this request and never saved or logged. Cursor masks existing keys, so a new dedicated key will be created when needed.",
      "检查该账号已有 Key": "Check Existing Keys",
      "确认创建新 Key 并导入": "Create & Import New Key",
      "取消": "Cancel",
      "确认导入并同步额度": "Import & Sync Quotas",
      "创建网关子密钥": "Create Client Sub-Key",
      "密钥名称备注": "Sub-Key Name",
      "例如：分享给前端组 Key / 临时测试 Key": "e.g. Frontend Team / Dev Key",
      "自定义 Token (留空自动生成 sk-cgw-...)": "Custom Token (blank = auto-generate sk-cgw-...)",
      "留空自动生成高强度随机密钥": "Leave blank for random high-entropy token",
      "最大调用次数限制 (留空或 0 = 无限制)": "Max Requests (blank or 0 = unlimited)",
      "无次数限制": "Unlimited",
      "无限制": "Unlimited",
      "50 次": "50",
      "200 次": "200",
      "1,000 次": "1,000",
      "最大并发请求数 (留空或 0 = 不限制)": "Max Concurrent Requests (blank or 0 = unlimited)",
      "不限制并发": "Unlimited",
      "不限制": "Unlimited",
      "到期失效时间 (留空 = 永不过期)": "Expiration Time (blank = never expires)",
      "永不过期": "Never",
      "+1 天": "+1d",
      "+7 天": "+7d",
      "+30 天": "+30d",
      "模型访问权限策略": "Model Access Policy",
      "允许访问全部全局已启用模型 (无单独模型限制)": "Allow all globally enabled models (unrestricted)",
      "仅允许访问下方勾选的指定模型 (自定义模型白名单)": "Allow only checked models below (custom allowlist)",
      "搜索模型 ID 或名称...": "Search model ID or name...",
      "已选 0 项": "0 picked",
      "仅勾 Auto 免费池": "Auto Pool Only",
      "仅勾 Grok": "Grok Only",
      "全选": "Select All",
      "保存网关密钥配置": "Save Sub-Key"
    };


    // ==================== CUSTOM STYLED SELECTS ====================
    const cSelMenu = $("cSelMenu");
    let cSelActive = null;
    function closeCSelMenu() {
      if (cSelMenu) cSelMenu.classList.remove("open");
      if (cSelActive) { cSelActive.trigger.classList.remove("open"); cSelActive = null; }
    }
    function syncSelectUi(sel) {
      if (!sel || !sel._cSelTrigger) return;
      const opt = sel.options[sel.selectedIndex] || sel.options[0];
      sel._cSelLbl.textContent = opt ? opt.textContent : "";
      if (sel.classList.contains("mono")) sel._cSelTrigger.classList.add("mono");
    }
    function enhanceSelect(sel) {
      if (!sel || sel._cSelWrap) { syncSelectUi(sel); return; }
      const wrap = document.createElement("div");
      wrap.className = "c-sel-wrap";
      if (sel.style.minWidth) wrap.style.minWidth = sel.style.minWidth;
      if (sel.style.width) wrap.style.width = sel.style.width;
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "c-sel-trigger" + (sel.classList.contains("mono") ? " mono" : "");
      const lbl = document.createElement("span");
      lbl.className = "c-sel-trigger-lbl";
      trigger.appendChild(lbl);
      const chev = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      chev.setAttribute("viewBox", "0 0 24 24");
      chev.setAttribute("fill", "none");
      chev.setAttribute("stroke", "currentColor");
      chev.setAttribute("stroke-width", "2");
      chev.setAttribute("class", "c-sel-chev");
      chev.innerHTML = '<polyline points="6 9 12 15 18 9"/>';
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      wrap.appendChild(trigger);
      wrap.appendChild(chev);
      sel.classList.add("c-sel-native");
      sel._cSelWrap = wrap;
      sel._cSelTrigger = trigger;
      sel._cSelLbl = lbl;
      syncSelectUi(sel);
      trigger.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (cSelActive && cSelActive.sel === sel) { closeCSelMenu(); return; }
        closeCSelMenu();
        cSelActive = { sel, trigger };
        trigger.classList.add("open");
        cSelMenu.innerHTML = "";
        Array.from(sel.options).forEach((o) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "c-sel-opt" + (o.value === sel.value ? " active" : "") + (sel.classList.contains("mono") ? " mono" : "");
          const t = document.createElement("span");
          t.textContent = o.textContent;
          const chk = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          chk.setAttribute("viewBox", "0 0 24 24");
          chk.setAttribute("fill", "none");
          chk.setAttribute("stroke", "currentColor");
          chk.setAttribute("stroke-width", "2.4");
          chk.setAttribute("class", "c-sel-chk");
          chk.innerHTML = '<polyline points="20 6 9 17 4 12"/>';
          item.appendChild(t);
          item.appendChild(chk);
          item.onclick = () => {
            if (sel.value !== o.value) {
              sel.value = o.value;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
            }
            syncSelectUi(sel);
            closeCSelMenu();
          };
          cSelMenu.appendChild(item);
        });
        const rect = trigger.getBoundingClientRect();
        cSelMenu.style.minWidth = Math.max(rect.width, 160) + "px";
        cSelMenu.classList.add("open");
        const mw = cSelMenu.offsetWidth || rect.width;
        const mh = cSelMenu.offsetHeight || 200;
        const left = Math.min(window.innerWidth - mw - 12, Math.max(12, rect.left));
        const top = rect.bottom + mh + 12 > window.innerHeight ? Math.max(12, rect.top - mh - 4) : rect.bottom + 4;
        cSelMenu.style.left = left + "px";
        cSelMenu.style.top = top + "px";
      });
    }
    function syncAllSelects() { document.querySelectorAll("select").forEach(enhanceSelect); }
    document.addEventListener("click", closeCSelMenu);
    window.addEventListener("resize", closeCSelMenu);

    function tr(zh, en) { return currentLang === "en" ? en : zh; }

    const nodeOrigMap = new WeakMap();
    function applyDomI18n() {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walk.nextNode())) {
        const p = node.parentElement;
        if (!p || p.tagName === "SCRIPT" || p.tagName === "STYLE" || p.classList.contains("mono")) continue;
        const raw = node.nodeValue || "";
        const trimmed = raw.trim();
        if (!trimmed) continue;

        let orig = nodeOrigMap.get(node);
        if (!orig && EN_STATIC[trimmed]) {
          orig = trimmed;
          nodeOrigMap.set(node, orig);
        }
        if (orig) {
          const target = currentLang === "en" ? (EN_STATIC[orig] || orig) : orig;
          node.nodeValue = raw.replace(trimmed, target);
        }
      }
      document.querySelectorAll("[placeholder],[title],[aria-label]").forEach((el) => {
        ["placeholder", "title", "aria-label"].forEach((attr) => {
          const cur = el.getAttribute(attr);
          if (!cur) return;
          const dataAttr = "data-i18n-orig-" + attr;
          if (!el.hasAttribute(dataAttr) && EN_STATIC[cur]) el.setAttribute(dataAttr, cur);
          if (el.hasAttribute(dataAttr)) {
            const orig = el.getAttribute(dataAttr) || "";
            el.setAttribute(attr, currentLang === "en" ? (EN_STATIC[orig] || orig) : orig);
          }
        });
      });
    }

    function applyLang(lang) {
      currentLang = lang === "en" ? "en" : "zh";
      localStorage.setItem(LANG_KEY, currentLang);
      document.documentElement.lang = currentLang === "en" ? "en" : "zh-CN";
      applyDomI18n();
      if (typeof syncAllSelects === 'function') syncAllSelects();
      if ($("langToggleBtn")) $("langToggleBtn").querySelector(".tb-lbl").textContent = currentLang === "en" ? "EN" : "中文";
      if ($("loginLangBtn")) $("loginLangBtn").textContent = currentLang === "en" ? "中文" : "EN";
      if ($("pgPrompt") && ($("pgPrompt").value === "请先思考一下：为什么 0.1 + 0.2 在浮点数里不等于 0.3？用一句话总结。" || $("pgPrompt").value === "Briefly explain in one sentence why 0.1 + 0.2 !== 0.3 in floating-point arithmetic.")) {
        $("pgPrompt").value = currentLang === "en"
          ? "Briefly explain in one sentence why 0.1 + 0.2 !== 0.3 in floating-point arithmetic."
          : "请先思考一下：为什么 0.1 + 0.2 在浮点数里不等于 0.3？用一句话总结。";
      }
      if ($("themeToggleBtn")) applyTheme(document.documentElement.getAttribute("data-theme") || "light");
      if ($("livePollLogsBtn")) $("livePollLogsBtn").textContent = tr("实时刷新(3s): ", "Live Poll (3s): ") + (liveLogsPoll ? tr("开", "ON") : tr("关", "OFF"));
      if ($("topbarTitle")) $("topbarTitle").textContent = (tabTitles[activeTab] ? tabTitles[activeTab]() : tr("控制台", "Console"));
      if ($("onboardSteps")) $("onboardSteps").innerHTML = currentLang === "en" ? '1. Click <strong>+ Add Credential</strong> on the right to add a Cursor <span class="mono">crsr_...</span> key (or generate one via SessionToken).<br/>2. Point your AI client to this gateway with your <span class="mono">GATEWAY_TOKEN</span> (or the auto-generated <span class="mono">sk-cgw-...</span> key in <strong>Sub-Keys</strong>) — ready to use.' : '① 点击右侧「+ 添加凭证」填入你的 Cursor <span class="mono">crsr_...</span> 密钥（或使用 SessionToken 一键生成）。<br/>② 在 AI 客户端填入接口地址与 <span class="mono">GATEWAY_TOKEN</span>（或「网关子密钥管理」中自动生成的默认 <span class="mono">sk-cgw-...</span> 密钥）即可直接调用，无需重复建密钥。';
      if (lastConsoleData) renderAll(lastConsoleData);
      if (lastOverviewData) renderOverview(lastOverviewData);
      if (logsCache.length) renderLogsTable();
      if (openTraceDetail) renderDrawerContent();
      if (modelsCatalogCache.length) renderModelsTable();
      if (clientKeysCache.length) renderClientKeysTable();
      if ($("appShell").style.display !== "none") showConsole();
    }

    function applyTheme(t) {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem(THEME_KEY, t);
      $("themeToggleBtn").querySelector(".tb-lbl").textContent = t === "dark" ? tr("深色", "Dark") : tr("浅色", "Light");
    }
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    syncAllSelects();
    $("themeToggleBtn").onclick = () => {
      const cur = document.documentElement.getAttribute("data-theme");
      applyTheme(cur === "dark" ? "light" : "dark");
    };
    $("langToggleBtn").onclick = () => applyLang(currentLang === "zh" ? "en" : "zh");
    $("loginLangBtn").onclick = () => applyLang(currentLang === "zh" ? "en" : "zh");

    function notify(msg, isErr = false) {
      const bar = $("noticeBar");
      $("noticeText").textContent = msg;
      bar.className = isErr ? "show err" : "show";
    }
    window.hideNotice = () => { $("noticeBar").className = ""; };

    function esc(v) {
      const d = document.createElement("div");
      d.textContent = v == null ? "" : String(v);
      return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
    // Friendly token counts: 1.2万 / 3.4亿 (zh) or 12.3K / 3.4M (en); full number stays in hover title.
    function fmtTok(n) {
      const v = Number(n || 0), a = Math.abs(v);
      if (currentLang === "en") {
        if (a >= 999950000) return String(Number((v / 1000000000).toFixed(2))) + "B";
        if (a >= 999950) return String(Number((v / 1000000).toFixed(2))) + "M";
        if (a >= 1000) return String(Number((v / 1000).toFixed(1))) + "K";
        return fmt(v);
      }
      if (a >= 99995000) return String(Number((v / 100000000).toFixed(2))) + "亿";
      if (a >= 10000) return String(Number((v / 10000).toFixed(a >= 1000000 ? 1 : 2))) + "万";
      return fmt(v);
    }
    function tokSpan(n, extraStyle) {
      return '<span title="' + esc(fmt(n)) + '"' + (extraStyle ? ' style="' + extraStyle + '"' : '') + '>' + fmtTok(n) + '</span>';
    }

    function barColor(used) {
      if (used == null) return "var(--fg-faint)";
      if (used >= 90) return "var(--err)";
      if (used >= 70) return "var(--warn)";
      return "var(--ok)";
    }


    async function api(path, opts = {}) {
      const headers = Object.assign({ "Content-Type": "application/json", "X-Console-CSRF": "1", "X-Console-Lang": currentLang }, opts.headers || {});
      if (sessionBearer) headers["Authorization"] = "Bearer " + sessionBearer;
      const res = await fetch(basePath + path, Object.assign({ credentials: "same-origin" }, opts, { headers }));
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        showLoginGate();
        throw new Error((data.error && data.error.message) || tr("登录会话已过期", "Session expired"));
      }
      if (!res.ok) {
        throw new Error((data.error && data.error.message) || ("HTTP " + res.status));
      }
      return data;
    }

    function showLoginGate(errMsg = "") {
      $("appShell").style.display = "none";
      $("loginGate").style.display = "flex";
      $("loginErrText").textContent = errMsg;
      setTimeout(() => $("loginPwdInput").focus(), 50);
    }

    function showConsole() {
      $("loginGate").style.display = "none";
      $("appShell").style.display = "grid";
      const originBase = location.origin + basePath;
      const tokPlaceholder = tr("<你的 GATEWAY_TOKEN>", "<YOUR_GATEWAY_TOKEN>");
      $("snippetOpenai").textContent =
        "Base URL: " + originBase + "/v1\\n" +
        "API Key : " + tokPlaceholder + "\\n" +
        "Models  : grok-4.6[fast=true,effort=low] | grok-4.6[effort=high] | grok-4.7[reasoning_effort=high]";
      $("snippetClaude").textContent =
        "export ANTHROPIC_BASE_URL=\\\"" + originBase + "\\\"\\n" +
        "export ANTHROPIC_API_KEY=\\\"" + tokPlaceholder + "\\\"";
    }

    const tabTitles = {
      overview: () => tr("总览监控", "Overview"),
      logs: () => tr("实时请求日志", "Request Logs"),
      credentials: () => tr("凭证与额度池", "Credentials & Quotas"),
      clientkeys: () => tr("网关子密钥管理", "Client Sub-Keys"),
      models: () => tr("模型权限管理", "Model Access"),
      routing: () => tr("路由与亲和策略", "Routing & Affinity"),
      playground: () => tr("在线测试与接入", "Playground & Setup")
    };

    function switchTab(tab) {
      activeTab = tab;
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === tab));
      document.querySelectorAll(".view-pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + tab));
      $("topbarTitle").textContent = tabTitles[tab] ? tabTitles[tab]() : tr("控制台", "Console");
      if (tab === "logs") fetchLogs();
      if (tab === "models" && modelsCatalogCache.length === 0) loadModelsCatalog();
      if (tab === "clientkeys") {
        loadClientKeys();
        if (modelsCatalogCache.length === 0) loadModelsCatalog();
      }
    }

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.onclick = () => switchTab(btn.getAttribute("data-tab"));
    });

    window.jumpToAccountLogs = (slotId) => {
      $("logAccountFilter").value = slotId;
      switchTab("logs");
      renderLogsTable();
    };

    function updateAccountFilterDropdown(pool) {
      const sel = $("logAccountFilter");
      const prev = sel.value || "all";
      let html = '<option value="all">' + esc(tr("全部执行账号", "All Accounts")) + '</option>';
      pool.forEach((s) => {
        const title = (s.label ? (s.label + " (" + s.maskedKey + ")") : s.maskedKey);
        html += '<option value="' + esc(s.slotId) + '">' + esc(title) + '</option>';
      });
      sel.innerHTML = html;
      if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    }

    function renderQuotaCell(poolObj) {
      const rem = poolObj && poolObj.remainingPercent != null ? poolObj.remainingPercent : null;
      if (rem === null) return '<span style="color:var(--fg-faint);" title="' + esc(tr("点击同步最新额度获取", "Click Sync Quotas to fetch")) + '">—</span>';
      const used = Math.max(0, Math.min(100, 100 - rem));
      return '<div class="qbar-cell" title="' + esc(tr("已用 ", "Used ") + used.toFixed(1) + tr("% · 剩余 ", "% · left ") + rem.toFixed(1) + '%') + '">' +
        '<div class="qbar-top"><span class="mono">' + used.toFixed(1) + '%</span><span class="qbar-rem">' + esc(tr("剩余 ", "Left ")) + rem.toFixed(1) + '%</span></div>' +
        '<div class="qbar-track"><div class="qbar-fill" style="width:' + used + '%;background:' + barColor(used) + ';"></div></div>' +
      '</div>';
    }

    function renderBotCell(bot) {
      if (!bot) return '<span style="color:var(--fg-faint);">—</span>';
      if (!bot.hasLimit) return '<span style="color:var(--fg-muted);">' + esc(tr("无 Bot 额度", "No Bot Quota")) + '</span>';
      const rem = bot.remainingPercent;
      return '<div class="bot-stack">' + renderQuotaCell({ remainingPercent: rem }) + (bot.resetAt ? '<div style="font-size:11px;color:var(--fg-muted);margin-top:2px;">' + esc(tr("重置 ", "Resets ")) + esc(new Date(bot.resetAt).toLocaleDateString()) + '</div>' : '') + '</div>';
    }

    function renderStatusDot(slot) {
      if (!slot.enabled) {
        return slot.autoDisabledKind === "auth"
          ? '<span class="status-line" style="color:var(--err);"><span class="dot dot-err"></span>' + esc(tr("鉴权失败·已停用", "Auth Failed · Disabled")) + '</span>'
          : slot.autoDisabledKind === "quota"
          ? '<span class="status-line" style="color:var(--warn);"><span class="dot dot-err"></span>' + esc(tr("额度耗尽·待恢复", "Exhausted · Waiting Reset")) + '</span>'
          : slot.autoDisabledReason
          ? '<span class="status-line" style="color:var(--err);"><span class="dot dot-err"></span>' + esc(tr("自动熔断", "Auto-Tripped")) + '</span>'
          : '<span class="status-line" style="color:var(--fg-muted);"><span class="dot dot-off"></span>' + esc(tr("备用停用", "Standby")) + '</span>';
      }
      if (slot.cooldownRemainingMs > 0) {
        return '<span class="status-line" style="color:var(--warn);"><span class="dot dot-warn"></span>' + esc(tr("冷却 ", "Cooldown ")) + Math.ceil(slot.cooldownRemainingMs / 1000) + 's</span>';
      }
      return '<span class="status-line"><span class="dot dot-ok"></span>' + esc(tr("在线负载", "Active")) + '</span>';
    }

    // ==================== OVERVIEW (ledger-backed charts) ====================
    let ovRange = "today";
    let ovDistMode = "model";
    const OV_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444", "#06b6d4", "#84cc16", "#8e8e96"];

    function ovEmpty(msg) { return '<div class="ov-empty">' + esc(msg || tr("暂无数据", "No data")) + '</div>'; }

    function showOvTip(ev, html) {
      const tip = $("ovTip");
      if (!tip) return;
      tip.innerHTML = html;
      tip.classList.add("show");
      const pad = 14;
      const w = tip.offsetWidth || 180, h = tip.offsetHeight || 70;
      const left = Math.min(window.innerWidth - w - pad, ev.clientX + 14);
      const top = Math.max(pad, ev.clientY - h - 10);
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }
    function hideOvTip() {
      const tip = $("ovTip");
      if (tip) tip.classList.remove("show");
    }

    function ovDonut(rows) {
      const total = rows.reduce((a, r) => a + r.totalTokens, 0);
      if (!rows.length || total <= 0) return ovEmpty(tr("该时间段内暂无调用", "No requests in this range"));
      const S = 156, CX = 78, CY = 78, R = 57, C = 2 * Math.PI * R;
      const gap = rows.length > 1 ? 2.2 : 0;
      let off = 0;
      const arcs = rows.map((r, i) => {
        const fullLen = (r.totalTokens / total) * C;
        const drawLen = Math.max(1.5, fullLen - gap);
        const color = OV_COLORS[i % OV_COLORS.length];
        const el = '<circle class="ov-donut-arc" data-idx="' + i + '" cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="' + color + '" stroke-width="20" stroke-dasharray="' + drawLen.toFixed(2) + ' ' + (C - drawLen).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 ' + CX + ' ' + CY + ')"/>';
        off += fullLen;
        return el;
      }).join("");
      const legend = rows.map((r, i) => {
        const pct = (r.totalTokens / total * 100).toFixed(1) + "%";
        const color = OV_COLORS[i % OV_COLORS.length];
        return '<div class="ov-dl-row" data-idx="' + i + '">' +
          '<span class="ov-sw" style="background:' + color + '"></span>' +
          '<span class="ov-dl-nm mono" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
          '<span class="ov-dl-req">' + fmt(r.requests) + tr(" 次", " reqs") + '</span>' +
          '<span class="ov-dl-tok mono">' + fmtTok(r.totalTokens) + ' · ' + pct + '</span>' +
          '</div>';
      }).join("");
      return '<div class="ov-donut-wrap">' +
        '<svg width="' + S + '" height="' + S + '" viewBox="0 0 ' + S + ' ' + S + '">' +
        '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="var(--subtle)" stroke-width="20"/>' +
        arcs +
        '<text id="ovDonutVal" x="' + CX + '" y="' + (CY - 2) + '" text-anchor="middle" font-size="16" font-weight="600" fill="var(--fg)">' + esc(fmtTok(total)) + '</text>' +
        '<text id="ovDonutSub" x="' + CX + '" y="' + (CY + 16) + '" text-anchor="middle" font-size="10.5" fill="var(--fg-muted)">' + esc(tr("总 Tokens", "total tokens")) + '</text>' +
        '</svg>' +
        '<div class="ov-donut-legend">' + legend + '</div></div>';
    }

    function bindOvDonutHover(rows) {
      const box = $("ovDonut");
      if (!box || !rows.length) return;
      const total = rows.reduce((a, r) => a + r.totalTokens, 0);
      if (total <= 0) return;
      const arcs = Array.from(box.querySelectorAll(".ov-donut-arc"));
      const items = Array.from(box.querySelectorAll(".ov-dl-row"));
      const valEl = $("ovDonutVal"), subEl = $("ovDonutSub");
      const activate = (idx, ev) => {
        arcs.forEach((a, i) => {
          a.style.opacity = i === idx ? "1" : "0.28";
          a.setAttribute("stroke-width", i === idx ? "24" : "20");
        });
        items.forEach((it, i) => {
          it.classList.toggle("is-hot", i === idx);
          it.style.opacity = i === idx ? "1" : "0.55";
        });
        const r = rows[idx];
        const pct = (r.totalTokens / total * 100).toFixed(1) + "%";
        if (valEl) valEl.textContent = fmtTok(r.totalTokens);
        if (subEl) subEl.textContent = pct;
        if (ev) {
          const color = OV_COLORS[idx % OV_COLORS.length];
          showOvTip(ev,
            '<div class="ov-tip-hdr mono"><span class="ov-sw" style="display:inline-block;background:' + color + ';margin-right:6px;"></span>' + esc(r.name) + '</div>' +
            '<div class="ov-tip-row"><span class="ov-tip-k">Tokens</span><span>' + fmt(r.totalTokens) + ' (' + pct + ')</span></div>' +
            '<div class="ov-tip-row"><span class="ov-tip-k">' + tr("请求数", "Requests") + '</span><span>' + fmt(r.requests) + '</span></div>'
          );
        }
      };
      const reset = () => {
        arcs.forEach((a) => { a.style.opacity = "1"; a.setAttribute("stroke-width", "20"); });
        items.forEach((it) => { it.classList.remove("is-hot"); it.style.opacity = "1"; });
        if (valEl) valEl.textContent = fmtTok(total);
        if (subEl) subEl.textContent = tr("总 Tokens", "total tokens");
        hideOvTip();
      };
      arcs.concat(items).forEach((el) => {
        const idx = Number(el.getAttribute("data-idx"));
        el.addEventListener("mouseenter", (ev) => activate(idx, ev));
        el.addEventListener("mousemove", (ev) => activate(idx, ev));
        el.addEventListener("mouseleave", reset);
      });
    }

    function ovTrendLabel(t, hours) {
      const d = new Date(t), p = (n) => String(n).padStart(2, "0");
      if (hours === 1) return p(d.getHours()) + ":00";
      if (hours === 6) return p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " + p(d.getHours()) + "h";
      return p(d.getMonth() + 1) + "/" + p(d.getDate());
    }

    function ovTrend(points, hours) {
      const sum = points.reduce((a, q) => a + q.inputTokens + q.cacheReadTokens + q.outputTokens, 0);
      if (!points.length || sum <= 0) return ovEmpty(tr("该时间段内暂无调用", "No requests in this range"));
      const W = 600, H = 200, L = 66, B = 24, T = 10, Rm = 24;
      const series = [
        { k: "inputTokens", c: "#3b82f6", n: tr("输入", "Input") },
        { k: "cacheReadTokens", c: "#10b981", n: tr("缓存读取", "Cache Read") },
        { k: "outputTokens", c: "#f59e0b", n: tr("输出", "Output") }
      ];
      const max = Math.max(1, ...points.map((q) => Math.max(q.inputTokens, q.cacheReadTokens, q.outputTokens)));
      const x = (i) => L + (points.length === 1 ? (W - L - Rm) / 2 : (i / (points.length - 1)) * (W - L - Rm));
      const y = (v) => T + (1 - v / max) * (H - T - B);
      let grid = "";
      for (let g = 0; g <= 3; g++) {
        const v = (max * g) / 3, yy = y(v);
        grid += '<line x1="' + L + '" x2="' + (W - Rm) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="var(--border)" stroke-width="1"' + (g > 0 ? ' stroke-dasharray="3 3"' : '') + '/>' +
          '<text x="' + (L - 8) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="var(--fg-muted)">' + esc(fmtTok(Math.round(v))) + '</text>';
      }
      const step = Math.max(1, Math.ceil(points.length / 6));
      let xl = "";
      points.forEach((q, i) => {
        if (i % step === 0 || i === points.length - 1) {
          if (i !== points.length - 1 && points.length - 1 - i < step * 0.45) return;
          xl += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10.5" fill="var(--fg-muted)">' + esc(ovTrendLabel(q.t, hours)) + '</text>';
        }
      });
      const baseY = y(0).toFixed(1);
      const lines = series.map((sr, si) => {
        const coords = points.map((q, i) => [x(i).toFixed(1), y(q[sr.k]).toFixed(1)]);
        const pts = coords.map((c) => c[0] + "," + c[1]).join(" ");
        const area = si < 2
          ? '<polygon points="' + coords[0][0] + ',' + baseY + ' ' + pts + ' ' + coords[coords.length - 1][0] + ',' + baseY + '" fill="' + sr.c + '" fill-opacity="0.07"/>'
          : '';
        return area + '<polyline points="' + pts + '" fill="none" stroke="' + sr.c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      }).join("");
      const hoverLayer = '<line id="ovTrendGuide" x1="0" x2="0" y1="' + T + '" y2="' + baseY + '" stroke="var(--fg-muted)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>' +
        series.map((sr, si) => '<circle id="ovTrendDot' + si + '" cx="0" cy="0" r="4" fill="' + sr.c + '" stroke="var(--panel)" stroke-width="1.5" style="display:none"/>').join("") +
        '<rect id="ovTrendHit" x="' + L + '" y="' + T + '" width="' + (W - L - Rm) + '" height="' + (H - T - B) + '" fill="transparent" style="cursor:crosshair"/>';
      $("ovTrendLegend").innerHTML = series.map((sr) => '<span><span class="ov-sw" style="display:inline-block;background:' + sr.c + ';margin-right:4px;"></span>' + sr.n + '</span>').join("");
      return '<svg viewBox="0 0 ' + W + ' ' + H + '">' + grid + xl + lines + hoverLayer + '</svg>';
    }

    function bindOvTrendHover(points, hours) {
      const hit = $("ovTrendHit");
      const svg = hit && hit.ownerSVGElement;
      if (!hit || !svg || !points.length) return;
      const W = 600, H = 200, L = 66, B = 24, T = 10, Rm = 24;
      const max = Math.max(1, ...points.map((q) => Math.max(q.inputTokens, q.cacheReadTokens, q.outputTokens)));
      const xAt = (i) => L + (points.length === 1 ? (W - L - Rm) / 2 : (i / (points.length - 1)) * (W - L - Rm));
      const yAt = (v) => T + (1 - v / max) * (H - T - B);
      const series = [
        { k: "inputTokens", c: "#3b82f6", n: tr("输入", "Input") },
        { k: "cacheReadTokens", c: "#10b981", n: tr("缓存读取", "Cache Read") },
        { k: "outputTokens", c: "#f59e0b", n: tr("输出", "Output") }
      ];
      const guide = $("ovTrendGuide");
      const dots = series.map((_, i) => $("ovTrendDot" + i));
      const onMove = (ev) => {
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        const svgX = ((ev.clientX - rect.left) / rect.width) * W;
        const ratio = Math.max(0, Math.min(1, (svgX - L) / (W - L - Rm)));
        const idx = points.length === 1 ? 0 : Math.round(ratio * (points.length - 1));
        const q = points[idx];
        const px = xAt(idx).toFixed(1);
        if (guide) { guide.setAttribute("x1", px); guide.setAttribute("x2", px); guide.style.display = ""; }
        dots.forEach((d, si) => {
          if (!d) return;
          d.setAttribute("cx", px);
          d.setAttribute("cy", yAt(q[series[si].k]).toFixed(1));
          d.style.display = "";
        });
        showOvTip(ev,
          '<div class="ov-tip-hdr mono">' + esc(ovTrendLabel(q.t, hours)) + '</div>' +
          series.map((sr) =>
            '<div class="ov-tip-row"><span class="ov-tip-k"><span class="ov-sw" style="background:' + sr.c + '"></span>' + sr.n + '</span><span>' + fmtTok(q[sr.k]) + '</span></div>'
          ).join("")
        );
      };
      const onLeave = () => {
        if (guide) guide.style.display = "none";
        dots.forEach((d) => { if (d) d.style.display = "none"; });
        hideOvTip();
      };
      hit.addEventListener("mouseenter", onMove);
      hit.addEventListener("mousemove", onMove);
      hit.addEventListener("mouseleave", onLeave);
    }


    let ovRecentCache = [];
    function fillOvFilter(id, label, values) {
      const sel = $(id), cur = sel.value;
      sel.innerHTML = '<option value="">' + esc(label) + '</option>' +
        values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join("");
      sel.value = values.includes(cur) ? cur : "";
      syncSelectUi(sel);
    }
    window.renderOvRecent = () => {
      const ip = $("ovFilterIp").value, key = $("ovFilterKey").value, cl = $("ovFilterClient").value;
      const matched = ovRecentCache.filter((r) => (!ip || r.ip === ip) && (!key || r.key === key) && (!cl || (r.client || "unknown") === cl));
      const shown = matched.slice(0, 10);
      if ($("ovRecentSub")) {
        $("ovRecentSub").textContent = matched.length > 10
          ? tr("仅元数据，当前展示前 10 条（共 " + matched.length + " 条）", "Metadata only · showing latest 10 of " + matched.length)
          : tr("仅元数据，默认展示最近 10 条（不保存任何对话内容）", "Metadata only · latest 10 requests (no conversation text stored)");
      }
      $("ovRecentBody").innerHTML = ovRecent(shown, ovRecentCache.length > 0);
    };

    function ovRecent(rows, hasAny) {
      if (!rows.length) return '<tr><td colspan="9" style="text-align:center;color:var(--fg-muted);padding:24px;">' + (hasAny ? tr("当前筛选条件下无请求", "No matching requests") : tr("暂无请求记录", "No request records yet")) + '</td></tr>';
      return rows.map((r) => {
        const d = new Date(r.at), p = (n) => String(n).padStart(2, "0");
        const when = p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
        const st = r.ok ? '<span class="tag tag-ok">' + r.status + '</span>' : '<span class="tag" style="color:var(--err);border-color:var(--err);">' + r.status + '</span>';
        return '<tr><td class="mono" style="white-space:nowrap;">' + when + '</td>' +
          '<td class="mono">' + esc(r.model) + '</td><td>' + esc(r.key) + '</td>' +
          '<td class="mono">' + esc(r.ip) + '</td><td title="' + esc(r.ua || "") + '">' + esc(r.client || "unknown") + '</td><td>' + esc(r.account) + '</td><td>' + st + '</td>' +
          '<td class="mono">' + (r.durationMs / 1000).toFixed(1) + 's</td>' +
          '<td class="mono" style="white-space:nowrap;">' + fmtTok(r.inputTokens) + ' / <span style="color:var(--ok);">' + fmtTok(r.cacheReadTokens) + '</span> / ' + fmtTok(r.outputTokens) + '</td></tr>';
      }).join("");
    }

    function renderOvDist(o) {
      const data = o || lastOverviewData || {};
      const rows = ovDistMode === "account" ? (data.byAccount || []) : ovDistMode === "key" ? (data.byKey || []) : (data.byModel || []);
      if ($("ovDistTitle")) {
        $("ovDistTitle").textContent = ovDistMode === "account"
          ? tr("账号分布（按 Token）", "Account Share (Tokens)")
          : ovDistMode === "key"
            ? tr("子密钥分布（按 Token）", "Sub-Key Share (Tokens)")
            : tr("模型分布（按 Token）", "Model Share (Tokens)");
      }
      $("ovDonut").innerHTML = ovDonut(rows);
      bindOvDonutHover(rows);
    }
    window.setOvDist = (mode) => {
      ovDistMode = mode || "model";
      document.querySelectorAll("#ovDistSeg button").forEach((b) => b.classList.toggle("active", b.dataset.arg === ovDistMode));
      renderOvDist(lastOverviewData);
    };

    function renderOverview(o) {
      lastOverviewData = o;
      const t = o.totals || {};
      $("ovReq").textContent = fmt(t.requests);
      $("ovErrTag").textContent = tr("错误 ", "Errors ") + fmt(t.errors);
      $("ovReqSub").textContent = t.requests ? (tr("成功率 ", "Success Rate ") + ((1 - t.errors / t.requests) * 100).toFixed(1) + "%") : tr("成功率 —", "Success Rate —");
      $("ovTok").innerHTML = tokSpan(t.totalTokens);
      $("ovTokSub").textContent = tr("输入 ", "In ") + fmtTok(t.inputTokens) + tr(" · 缓存 ", " · Cache ") + fmtTok(t.cacheReadTokens) + tr(" · 输出 ", " · Out ") + fmtTok(t.outputTokens);
      $("ovCache").textContent = (t.cacheHitRatePercent || 0) + "%";
      renderOvDist(o);
      $("ovTrend").innerHTML = ovTrend(o.trend || [], o.bucketHours || 1);
      bindOvTrendHover(o.trend || [], o.bucketHours || 1);
      ovRecentCache = o.recent || [];
      fillOvFilter("ovFilterIp", tr("全部 IP", "All IPs"), [...new Set(ovRecentCache.map((r) => r.ip))]);
      fillOvFilter("ovFilterClient", tr("全部客户端", "All Clients"), [...new Set(ovRecentCache.map((r) => r.client || "unknown"))]);
      fillOvFilter("ovFilterKey", tr("全部子密钥", "All Sub-Keys"), [...new Set(ovRecentCache.map((r) => r.key))]);
      window.renderOvRecent();
    }

    async function loadOverview() {
      try {
        const o = await api("/v1/admin/overview?range=" + ovRange);
        renderOverview(o);
      } catch (e) {
        if ($("appShell").style.display !== "none") notify(e.message, true);
      }
    }

    window.setOvRange = (r) => {
      ovRange = r;
      document.querySelectorAll("#ovRangeSeg .btn-xs").forEach((b) => b.classList.toggle("active", b.getAttribute("data-arg") === r));
      void loadOverview();
    };

    function renderAll(data) {
      lastConsoleData = data;
      const pool = data.keyPool || [];
      poolSlotsCache = pool;
      updateAccountFilterDropdown(pool);

      const usage = data.gatewaySessionUsage || data;
      const settings = data.settings || {};
      const affinities = data.affinities || [];
      const tot = usage.totals || {};

      const enabledCount = pool.filter((s) => s.enabled).length;
      if ($("onboardBanner")) $("onboardBanner").classList.toggle("show", pool.length === 0);
      const autoTripped = pool.filter((s) => !s.enabled && s.autoDisabledReason).length;
      const inflight = pool.reduce((a, s) => a + (s.activeInflight || 0), 0);

      $("mStrategyTag").textContent = settings.lbStrategy || "quota-aware";
      $("mActiveKeys").textContent = enabledCount + " / " + pool.length;
      $("mInflightSub").textContent = tr("活跃并发流: ", "In-flight: ") + inflight + tr(" · 自动熔断: ", " · Auto-tripped: ") + autoTripped;

      $("overviewAccountsBody").innerHTML = pool.length ? pool.map((s) => {
        const q = s.quota || {};
        const idt = s.identity || {};
        const bd = q.overallIncludedPlan && q.overallIncludedPlan.breakdownUsd;
        const od = q.onDemandSpend;
        const billStr = (bd ? ('$' + bd.totalUsd + tr(' (含赠 $', ' (bonus $') + bd.bonusUsd + ')') : '—') +
          (od && od.enabled ? (tr(' · 按需 $', ' · On-Demand $') + od.usedUsd.toFixed(2)) : tr(' · 按需关', ' · On-Demand Off'));
        return '<tr class="clickable-row ' + (!s.enabled ? 'row-disabled' : '') + '" data-click="jumpToAccountLogs" data-arg="' + esc(s.slotId) + '" title="' + esc(tr("点击筛选查看该账号的请求日志", "Click to filter request logs for this account")) + '">' +
          '<td>' + renderStatusDot(s) + '</td>' +
          '<td><div style="font-weight:500;">' + esc(s.label || idt.userEmail || s.maskedKey) + '</div>' +
            '<div class="mono" style="color:var(--fg-muted);font-size:11px;">' + esc(s.maskedKey) + (idt.userEmail && s.label ? ' · ' + esc(idt.userEmail) : '') + '</div></td>' +
          '<td><span class="tag">' + esc((q.membershipType || '—').toUpperCase()) + '</span></td>' +
          '<td>' + renderQuotaCell(q.cursorModelsAutoPool) + '</td>' +
          '<td>' + renderQuotaCell(q.premiumApiPool) + '</td>' +
          '<td>' + renderBotCell(s.bot) + '</td>' +
          '<td style="font-size:12px;color:var(--fg-muted);">' + esc(billStr) + '</td>' +
          '<td class="mono">' + fmt(s.stickySessions) + tr(' 会话 / ', ' sess / ') + fmt(s.totalSelected) + tr(' 次', ' reqs') +
            '<div style="color:var(--fg-muted);font-size:11px;">' + esc(tr('粘性命中 ', 'Affinity hits ')) + fmt(s.affinityHits) + '</div></td>' +
        '</tr>';
      }).join("") : '<tr><td colspan="8" style="text-align:center;color:var(--fg-muted);padding:24px;">' + esc(tr("暂无凭证", "No credentials")) + '</td></tr>';

      $("credTableBody").innerHTML = pool.length ? pool.map((s) => {
        const q = s.quota || {};
        const idt = s.identity || {};
        const bd = q.overallIncludedPlan && q.overallIncludedPlan.breakdownUsd;
        const od = q.onDemandSpend;
        return '<tr class="' + (!s.enabled ? 'row-disabled' : '') + '">' +
          '<td><label class="switch"><input type="checkbox" ' + (s.enabled ? 'checked' : '') + ' data-change="toggleKey" data-arg="' + esc(s.slotId) + '" /><span class="slider"></span></label></td>' +
          '<td style="white-space:nowrap;"><div style="font-weight:500;">' + esc(s.label || tr('未命名凭证', 'Unlabeled Key')) + '</div><div class="mono" style="color:var(--fg-muted);">' + esc(s.maskedKey) + '</div></td>' +
          '<td style="white-space:nowrap;"><div>' + esc(idt.userEmail || '—') + ' <span class="tag">' + esc((q.membershipType || '—').toUpperCase()) + '</span></div>' +
            '<div style="font-size:11px;color:var(--fg-muted);">' + esc(tr('Key名: ', 'Key: ')) + esc(idt.apiKeyName || '—') + (q.daysRemainingInCycle != null ? (tr(' · 距重置 ', ' · Resets in ') + q.daysRemainingInCycle + tr(' 天', 'd')) : '') + '</div></td>' +
          '<td>' + renderQuotaCell(q.cursorModelsAutoPool) + '</td>' +
          '<td>' + renderQuotaCell(q.premiumApiPool) + '</td>' +
          '<td>' + renderBotCell(s.bot) + '</td>' +
          '<td class="bill-cell" style="font-size:11.5px;">' +
            '<div>' + esc(tr('套餐池: ', 'Plan: ')) + (bd ? ('$' + bd.includedUsd + tr(' + 赠 $', ' + bonus $') + bd.bonusUsd) : '—') + '</div>' +
            '<div style="color:' + (od && od.enabled ? 'var(--warn)' : 'var(--fg-muted)') + ';">On-Demand: ' + (od && od.enabled ? (tr('开启 (已用 $', 'ON (used $') + od.usedUsd.toFixed(2) + ')') : tr('已关闭', 'OFF')) + '</div>' +
          '</td>' +
          '<td class="run-cell" style="font-size:11.5px;">' +
            '<div>' + renderStatusDot(s) + '</div>' +
            (s.autoDisabledReason ? '<div style="color:' + (s.autoDisabledKind === 'quota' ? 'var(--warn)' : 'var(--err)') + ';margin-top:2px;">' + esc(s.autoDisabledReason) + '</div>' : '') +
            (s.autoDisabledKind === 'quota' ? '<div style="color:var(--fg-muted);margin-top:2px;">' + esc(tr('Key 本身有效，仅网关暂停调度；', 'Key valid, scheduling paused; ')) + (s.autoRecoverAt ? (tr('预计 ', 'est. ') + esc(new Date(s.autoRecoverAt).toLocaleString()) + tr(' 自动恢复，', ' auto-reset, ')) : '') + esc(tr('充值或开超额后，点“同步官方额度”即可恢复', 'click Sync Quotas after top-up')) + '</div>' : '') +
            (s.autoDisabledKind === 'auth' ? '<div style="color:var(--fg-muted);margin-top:2px;">' + esc(tr('上游拒绝了该 Key（可能已被吊销或失效），不会自动恢复；确认 Key 有效后请点“重新检测”', 'Rejected by upstream (revoked/invalid); click Recheck once valid')) + '</div>' : '') +
            '<div style="color:var(--fg-muted);margin-top:2px;">' + esc(tr('调度 ', 'Dispatched ')) + fmt(s.totalSelected) + esc(tr(' · 亲和 ', ' · Affinity ')) + fmt(s.affinityHits) + esc(tr(' · 429限流 ', ' · 429s ')) + fmt(s.rateLimitHits) + '</div>' +
          '</td>' +
          '<td class="ops-cell"><div class="ops-stack">' +
            '<button class="btn-xs" data-click="jumpToAccountLogs" data-arg="' + esc(s.slotId) + '">' + esc(tr('日志', 'Logs')) + '</button>' +
            (od ? '<button class="btn-xs" data-click="toggleOnDemand" data-arg="' + esc(s.slotId) + '" data-arg2="' + (od.enabled ? 'off' : 'on') + '">' + esc(od.enabled ? tr('关超额', 'Disable OD') : tr('开超额', 'Enable OD')) + '</button>' : '') +
            '<button class="btn-xs" data-click="editLabel" data-arg="' + esc(s.slotId) + '" data-arg2="' + esc(s.label || '') + '">' + esc(tr('备注', 'Label')) + '</button>' +
            (!s.enabled && s.autoDisabledKind ? '<button class="btn-xs" data-click="recheckKey" data-arg="' + esc(s.slotId) + '">' + esc(tr('重新检测', 'Recheck')) + '</button>' : '') +
            (s.cooldownRemainingMs > 0 ? '<button class="btn-xs" data-click="clearKeyCd" data-arg="' + esc(s.slotId) + '">' + esc(tr('解封', 'Uncool')) + '</button>' : '') +
            '<button class="btn-xs btn-danger" data-click="deleteKey" data-arg="' + esc(s.slotId) + '">' + esc(tr('移除', 'Remove')) + '</button>' +
          '</div></td>' +
        '</tr>';
      }).join("") : '<tr><td colspan="9" style="text-align:center;color:var(--fg-muted);padding:24px;">' + esc(tr("暂无凭证", "No credentials")) + '</td></tr>';

      if (settings.lbStrategy) { $("cfgLbStrategy").value = settings.lbStrategy; syncSelectUi($("cfgLbStrategy")); }
      $("cfgAffinityEnabled").checked = settings.sessionAffinityEnabled !== false;
      $("cfgAffinityTtl").value = settings.sessionAffinityTtlSeconds || 3600;
      $("cfgAutoDisable").checked = settings.autoDisableExhaustedKeys !== false;
      $("cfgAllowNativeWebTools").checked = settings.allowNativeWebTools === true;

      $("affinityTableBody").innerHTML = affinities.length ? affinities.map((a) =>
        '<tr>' +
          '<td class="mono">' + esc(a.conversationKey) + '</td>' +
          '<td class="mono">' + esc(a.maskedKey) + ' <span style="color:var(--fg-muted);">(' + esc(a.slotId) + ')</span></td>' +
          '<td class="mono">' + fmt(a.hitCount) + '</td>' +
          '<td class="mono" style="color:var(--fg-muted);">' + new Date(a.lastHitAt).toLocaleTimeString() + '</td>' +
          '<td class="mono">' + fmt(a.expiresInSeconds) + 's</td>' +
        '</tr>'
      ).join("") : '<tr><td colspan="5" style="text-align:center;color:var(--fg-muted);padding:20px;">' + esc(tr("当前无活跃粘性绑定会话", "No active sticky bindings")) + '</td></tr>';

      $("syncTimeLabel").textContent = tr("更新于 ", "Updated ") + new Date().toLocaleTimeString();
    }

    // ==================== REQUEST LOGS & CHAT-BLOCK INSPECTOR ====================
    function execModeLabel(mode) {
      if (mode === "parked_tool_resume") return tr("工具热续跑 (免重传)", "Parked Tool Resume");
      if (mode === "warm_incremental") return tr("Warm增量复用", "Warm Incremental");
      if (mode === "fresh") return tr("新建全量会话", "Fresh Replay");
      return "—";
    }

    function renderLogsTable() {
      const accFilter = $("logAccountFilter").value;
      const typeFilter = $("logFilterSelect").value;
      const kw = $("logSearchInput").value.trim().toLowerCase();

      const filtered = logsCache.filter((r) => {
        if (accFilter !== "all" && r.slotId !== accFilter) return false;
        if (typeFilter === "running" && r.status !== "running") return false;
        if (typeFilter === "tools" && !(r.emittedToolCallsCount > 0 || r.execMode === "parked_tool_resume")) return false;
        if (typeFilter === "thinking" && !r.hasThinking) return false;
        if (typeFilter === "error" && r.status !== "error") return false;
        if (kw) {
          const hay = (r.requestedModel + " " + (r.accountLabel || "") + " " + (r.maskedKey || "") + " " + (r.client || "") + " " + (r.userAgent || "")).toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      });
      $("navLogCount").textContent = logsCache.length;

      $("logsTableBody").innerHTML = filtered.length ? filtered.map((r) => {
        const stHtml = r.status === "running"
          ? '<span class="status-line" style="color:var(--warn);"><span class="dot dot-pulse"></span>' + esc(tr("生成中", "Running")) + '</span>'
          : r.status === "error"
            ? '<span class="status-line" style="color:var(--err);"><span class="dot dot-err"></span>' + r.httpStatus + '</span>'
            : '<span class="status-line"><span class="dot dot-ok"></span>200</span>';

        const badges = [];
        if (r.execMode === "parked_tool_resume" || r.execMode === "warm_incremental") {
          badges.push('<span class="tag tag-ok">' + esc(tr("实发 ", "Sent ")) + fmt(r.upstreamSentChars) + esc(tr("字", "ch")) + '</span>');
        }
        if (r.hasThinking) badges.push('<span class="tag">' + esc(tr("思考", "Thinking")) + '</span>');
        if (r.emittedToolCallsCount > 0) badges.push('<span class="tag">' + esc(tr("调工具×", "Tools ×")) + r.emittedToolCallsCount + '</span>');
        if (r.toolCount > 0 && r.emittedToolCallsCount === 0) badges.push('<span class="tag" style="opacity:0.7;">' + esc(tr("挂", "")) + r.toolCount + esc(tr("工具", " tools")) + '</span>');

        const m = r.metrics || {};
        const dur = r.durationMs != null ? (r.durationMs / 1000).toFixed(2) + "s" : "—";
        const ttft = r.ttftMs != null ? (r.ttftMs / 1000).toFixed(2) + "s" : "—";

        return '<tr class="clickable-row" data-click="openTrace" data-arg="' + esc(r.id) + '">' +
          '<td class="mono" style="white-space:nowrap;">' + new Date(r.startedAt).toLocaleTimeString() + '</td>' +
          '<td>' + stHtml + '</td>' +
          '<td><div class="mono" style="font-weight:500;">' + esc(r.requestedModel) + '</div>' +
            '<div style="font-size:11px;color:var(--fg-muted);">' + esc(r.protocol) + (r.stream ? ' · SSE' : ' · JSON') + (r.client ? (' · ' + esc(r.client)) : '') + (r.clientKeyName ? (' · ' + esc(r.clientKeyName)) : '') + (r.clientIp ? (' · IP ' + esc(r.clientIp)) : '') + '</div></td>' +
          '<td><div>' + esc(r.accountLabel || r.maskedKey || '—') + '</div>' +
            '<div style="font-size:11px;color:var(--fg-muted);">' + execModeLabel(r.execMode) + '</div></td>' +
          '<td style="max-width:340px;">' +
            '<div style="display:flex;gap:4px;margin-bottom:3px;flex-wrap:wrap;">' + badges.join("") + '</div>' +
            '<div style="color:var(--fg-muted);font-size:12px;">' + esc(tr("输出 ", "Out ")) + fmt(r.outputChars || 0) + esc(tr(" 字 · 上下文 ", " ch · Context ")) + fmt(r.transcriptTotalChars || 0) + esc(tr(" 字", " ch")) + '</div>' +
          '</td>' +
          '<td class="mono" style="white-space:nowrap;">' + ttft + ' / ' + dur + '</td>' +
          '<td class="mono" style="white-space:nowrap;">' + fmtTok(m.inputTokens) + ' / <span style="color:var(--ok);">' + fmtTok(m.cacheReadTokens) + '</span> / ' + fmtTok(m.outputTokens) + '</td>' +
        '</tr>';
      }).join("") : '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:32px;">' + esc(logsCache.length === 0 ? tr('当前暂无内存实时日志（服务重启会清空内存日志；历史累计与最近 10 条请求见「总览监控」）', 'No in-memory logs yet (restarts clear memory logs; historical stats & latest 10 requests remain in Overview)') : tr('当前筛选条件下无匹配日志', 'No matching request logs')) + '</td></tr>';
    }

    async function fetchLogs() {
      try {
        const data = await api("/v1/admin/logs");
        logsCache = data.logs || [];
        renderLogsTable();
        if (openTraceId) {
          const detail = await api("/v1/admin/logs/" + openTraceId).catch(() => null);
          if (detail) {
            openTraceDetail = detail;
            renderDrawerContent();
          }
        }
      } catch {}
    }

    window.openTrace = async (id) => {
      openTraceId = id;
      $("traceDrawer").classList.add("open");
      $("drTitle").textContent = tr("加载中 ", "Loading ") + id + "...";
      $("drBody").innerHTML = '<div style="color:var(--fg-muted);">' + esc(tr("正在读取...", "Loading...")) + '</div>';
      try {
        openTraceDetail = await api("/v1/admin/logs/" + id);
        renderDrawerContent();
      } catch (e) {
        $("drBody").innerHTML = '<div style="color:var(--err);">' + esc(tr("读取失败: ", "Failed to load: ")) + esc(e.message) + '</div>';
      }
    };

    window.closeTraceDrawer = () => {
      openTraceId = null;
      openTraceDetail = null;
      $("traceDrawer").classList.remove("open");
    };

    $("drRefreshBtn").onclick = () => { if (openTraceId) window.openTrace(openTraceId); };

    function renderDrawerContent() {
      const d = openTraceDetail;
      if (!d) return;
      const m = d.metrics || {};
      const dur = d.durationMs != null ? (d.durationMs / 1000).toFixed(2) + "s" : tr("进行中", "Running");
      const ttft = d.ttftMs != null ? (d.ttftMs / 1000).toFixed(2) + "s" : "—";
      $("drTitle").textContent = d.requestedModel + " · " + (d.status === "running" ? tr("生成中...", "Running...") : ("HTTP " + d.httpStatus));
      $("drSubtitle").textContent = d.id + " · " + new Date(d.startedAt).toLocaleString() + " · " + (d.accountLabel || d.maskedKey || "—") + (d.clientIp ? " · IP " + d.clientIp : "");

      const sentChars = d.upstreamSentChars || 0;
      const totalChars = d.transcriptTotalChars || 0;
      const savedNote = (d.execMode === "parked_tool_resume" || d.execMode === "warm_incremental")
        ? (tr('仅发增量 ', 'Sent delta ') + fmt(sentChars) + tr(' 字 (客户端带全量 ', ' ch (skipped ') + fmt(totalChars) + tr(' 字未重传)', ' ch full context)'))
        : (tr('全量发送 ', 'Full send ') + fmt(sentChars) + tr(' 字', ' ch'));
      const fp = d.fingerprint || {};
      const row = (k, v) => '<div class="kv-item"><span>' + k + '</span><strong class="mono">' + v + '</strong></div>';
      const tools = d.toolNames || [];

      $("drBody").innerHTML =
        '<div class="kv-grid">' +
          '<div class="kv-item"><span>' + esc(tr('执行模式 & 网络实发', 'Execution Mode & Payload')) + '</span><strong>' + esc(execModeLabel(d.execMode)) + '</strong><span style="margin-top:2px;">' + esc(savedNote) + '</span></div>' +
          '<div class="kv-item"><span>' + esc(tr('首包 TTFT / 总耗时 & Tokens', 'TTFT / Total & Tokens')) + '</span><strong class="mono">' + ttft + ' / ' + dur + '</strong><span class="mono" style="margin-top:2px;">' + esc(tr('新发入 ', 'In ')) + fmtTok(m.inputTokens) + esc(tr(' · 缓存读 ', ' · Cache ')) + fmtTok(m.cacheReadTokens) + esc(tr(' · 输出 ', ' · Out ')) + fmtTok(m.outputTokens) + '</span></div>' +
          row(esc(tr('消息数 / 附图', 'Messages / Images')), fmt(d.messageCount || 0) + ' / ' + fmt(d.imageCount || 0)) +
          row(esc(tr('输出字数 / 思考 / 工具调用', 'Output Chars / Thinking / Tool Calls')), fmt(d.outputChars || 0) + ' / ' + (d.hasThinking ? tr('有', 'Yes') : tr('无', 'No')) + ' / ' + (d.emittedToolCallsCount || 0)) +
          row(esc(tr('会话指纹', 'Conversation Hash')), esc(fp.conversation || '—')) +
          row(esc(tr('前缀指纹 (上轮 → 本轮)', 'Prefix Hash (Prev → Cur)')), esc(fp.priorPrefix || '—') + ' → ' + esc(fp.currentPrefix || '—')) +
          row(esc(tr('挂载工具', 'Attached Tools')), tools.length ? esc(tools.join(', ')) : tr('无', 'None')) +
          row(esc(tr('客户端', 'Client')), esc(d.client || '—')) +
          row('User-Agent', esc(d.userAgent || '—')) +
          row(esc(tr('结束原因', 'Stop Reason')), esc(d.stopReason || '—')) +
        '</div>' +
        (d.errorMessage ? '<div><span class="field-lbl" style="color:var(--err);">' + esc(tr('错误信息', 'Error Message')) + '</span><pre class="code-block mono" style="border-color:var(--err);color:var(--err);">' + esc(d.errorMessage) + '</pre></div>' : '') +
        '<div style="font-size:12px;color:var(--fg-muted);">' + esc(tr('指纹是单向短哈希，仅用于判断两次请求是否属于同一对话前缀，无法还原内容。', 'Hashes are one-way 8-char fingerprints used only to match conversation prefixes; content cannot be reconstructed.')) + '</div>';
    }

    $("logAccountFilter").onchange = renderLogsTable;
    $("logFilterSelect").onchange = renderLogsTable;
    $("logSearchInput").oninput = renderLogsTable;
    $("manualRefreshLogsBtn").onclick = () => fetchLogs();
    $("clearLogsBtn").onclick = async () => {
      if (!confirm(tr("确定清空内存中的请求日志吗？（日志只含元数据）", "Clear in-memory request logs? (Metadata only)"))) return;
      await api("/v1/admin/logs/clear", { method: "POST", body: "{}" });
      await fetchLogs();
    };
    $("livePollLogsBtn").onclick = () => {
      liveLogsPoll = !liveLogsPoll;
      $("livePollLogsBtn").textContent = tr("实时刷新(3s): ", "Live Poll (3s): ") + (liveLogsPoll ? tr("开", "ON") : tr("关", "OFF"));
    };

    setInterval(() => {
      if (liveLogsPoll && $("appShell").style.display !== "none" && (activeTab === "logs" || openTraceId)) {
        fetchLogs();
      }
    }, 3000);

    // ==================== MODEL ACCESS CONTROL ====================
    function getFilteredModels() {
      const kw = $("modelSearchInput").value.trim().toLowerCase();
      const pf = $("modelPoolFilter").value;
      return modelsCatalogCache.filter((m) => {
        if (pf === "auto" && m.pool !== "auto") return false;
        if (pf === "api" && m.pool !== "api") return false;
        if (pf === "enabled" && !m.enabled) return false;
        if (pf === "disabled" && m.enabled) return false;
        if (kw && !(m.id.toLowerCase().includes(kw) || (m.displayName || "").toLowerCase().includes(kw))) return false;
        return true;
      });
    }

    function renderModelsTable() {
      const filtered = getFilteredModels();
      const enabledTotal = modelsCatalogCache.filter((m) => m.enabled).length;
      $("navModelCount").textContent = enabledTotal + "/" + modelsCatalogCache.length;
      $("modelSelSummary").textContent = tr("已勾选 ", "") + selectedModelIds.size + tr(" 项 (当前显示 ", " selected (showing ") + filtered.length + tr(" 项)", ")");

      $("modelSelectAllCb").checked = filtered.length > 0 && filtered.every((m) => selectedModelIds.has(m.id));

      $("modelsManageBody").innerHTML = filtered.length ? filtered.map((m) => {
        const checked = selectedModelIds.has(m.id) ? "checked" : "";
        const poolTag = m.pool === "auto"
          ? '<span class="tag tag-ok">' + esc(tr("Auto 池 (Grok/Composer)", "Auto Pool (Grok/Composer)")) + '</span>'
          : '<span class="tag tag-warn">' + esc(tr("高级 API 池 (外部模型)", "Premium API Pool")) + '</span>';
        const paramsStr = (m.parameters || []).length ? m.parameters.join(", ") : "—";
        return '<tr class="' + (!m.enabled ? 'row-disabled' : '') + '">' +
          '<td><input type="checkbox" ' + checked + ' data-change="toggleModelSelect" data-arg="' + esc(m.id) + '" /></td>' +
          '<td><label class="switch"><input type="checkbox" ' + (m.enabled ? 'checked' : '') + ' data-change="toggleSingleModel" data-arg="' + esc(m.id) + '" /><span class="slider"></span></label></td>' +
          '<td class="mono" style="font-weight:500;">' + esc(m.id) + '</td>' +
          '<td>' + esc(m.displayName) + '</td>' +
          '<td>' + poolTag + '</td>' +
          '<td class="mono" style="color:var(--fg-muted);">' + esc(paramsStr) + '</td>' +
        '</tr>';
      }).join("") : '<tr><td colspan="6" style="text-align:center;color:var(--fg-muted);padding:24px;">' + esc(tr("无匹配模型", "No matching models")) + '</td></tr>';
    }

    async function loadModelsCatalog() {
      $("refreshModelsBtn").disabled = true;
      $("refreshModelsBtn").textContent = tr("加载中...", "Loading...");
      try {
        const res = await api("/v1/admin/models");
        modelsCatalogCache = res.models || [];
        renderModelsTable();
      } catch (e) {
        notify(tr("加载模型目录失败: ", "Failed to load catalog: ") + e.message, true);
      } finally {
        $("refreshModelsBtn").disabled = false;
        $("refreshModelsBtn").textContent = tr("刷新上游模型目录", "Refresh Catalog");
      }
    }

    window.toggleModelSelect = (id, checked) => {
      if (checked) selectedModelIds.add(id);
      else selectedModelIds.delete(id);
      renderModelsTable();
    };

    $("modelSelectAllCb").onchange = (ev) => {
      const checked = ev.target.checked;
      getFilteredModels().forEach((m) => {
        if (checked) selectedModelIds.add(m.id);
        else selectedModelIds.delete(m.id);
      });
      renderModelsTable();
    };

    $("modelSearchInput").oninput = renderModelsTable;
    $("modelPoolFilter").onchange = renderModelsTable;
    $("refreshModelsBtn").onclick = loadModelsCatalog;

    async function runModelBatch(action, modelsList, msg) {
      try {
        await api("/v1/admin/models/batch", {
          method: "POST",
          body: JSON.stringify({
            action,
            models: modelsList,
            allCatalogIds: modelsCatalogCache.map((m) => m.id)
          })
        });
        await loadModelsCatalog();
        if (msg) notify(msg);
      } catch (e) { notify(e.message, true); }
    }

    window.toggleSingleModel = (id, enabled) => {
      runModelBatch(enabled ? "enable" : "disable", [id], "");
    };

    $("batchEnableBtn").onclick = () => {
      if (!selectedModelIds.size) return notify(tr("请先勾选要操作的模型。", "Select at least one model first."), true);
      runModelBatch("enable", [...selectedModelIds], tr("已批量启用 ", "Enabled ") + selectedModelIds.size + tr(" 个模型。", " models."));
    };
    $("batchDisableBtn").onclick = () => {
      if (!selectedModelIds.size) return notify(tr("请先勾选要操作的模型。", "Select at least one model first."), true);
      runModelBatch("disable", [...selectedModelIds], tr("已批量禁用 ", "Disabled ") + selectedModelIds.size + tr(" 个模型。", " models."));
    };
    $("batchWhitelistBtn").onclick = () => {
      if (!selectedModelIds.size) return notify(tr("请先勾选要保留启用的白名单模型。", "Select models for the whitelist first."), true);
      if (!confirm(tr("确定仅保留已勾选的 " + selectedModelIds.size + " 个模型对外开放，并禁用其余所有模型吗？", "Keep only the " + selectedModelIds.size + " selected models enabled and disable all others?"))) return;
      runModelBatch("set_only_enabled", [...selectedModelIds], tr("已应用白名单模式，仅开放勾选的 ", "Whitelist applied: ") + selectedModelIds.size + tr(" 个模型。", " models enabled."));
    };
    $("batchDisableApiPoolBtn").onclick = () => {
      const apiModels = modelsCatalogCache.filter((m) => m.pool === "api").map((m) => m.id);
      if (!apiModels.length) return;
      if (!confirm(tr("确定一键禁用全部 " + apiModels.length + " 个高级 API 池模型（Claude/GPT/Gemini 等），仅开放 Auto 池模型吗？", "Disable all " + apiModels.length + " Premium API pool models and keep only Auto pool models enabled?"))) return;
      runModelBatch("disable", apiModels, tr("已一键禁用全部 ", "Disabled all ") + apiModels.length + tr(" 个外部高级 API 池模型。", " Premium API pool models."));
    };
    $("batchEnableAllBtn").onclick = () => {
      runModelBatch("enable_all", [], tr("已恢复启用全部模型。", "All models enabled."));
    };

    // ==================== CLIENT GATEWAY SUB-KEYS MANAGEMENT ====================
    async function loadClientKeys() {
      try {
        const res = await api("/v1/admin/client-keys");
        clientKeysCache = res.clientKeys || [];
        $("navClientKeyCount").textContent = clientKeysCache.length;
        renderClientKeysTable();
      } catch (e) { notify(e.message, true); }
    }

    window.copyCkToken = async (id) => {
      try {
        const res = await api("/v1/admin/client-keys/" + id + "/reveal");
        const found = clientKeysCache.find((k) => k.id === id);
        try {
          await navigator.clipboard.writeText(res.token);
          notify(tr("已复制网关密钥 「", "Copied token for '") + (found ? found.name : id) + tr("」 的完整 Token！", "'!"));
        } catch {
          prompt(tr("请手动复制完整网关密钥：", "Copy the full gateway token:"), res.token);
        }
      } catch (e) { notify(e.message, true); }
    };

    window.resetCkUsedCount = async (id) => {
      if (!confirm(tr("确定将该子密钥的已用请求次数归零重置吗？", "Reset used request count to 0 for this sub-key?"))) return;
      try {
        await api("/v1/admin/client-keys/" + id, {
          method: "PATCH",
          body: JSON.stringify({ resetRequests: true })
        });
        notify(tr("已重置该子密钥的调用次数计数。", "Request counter reset."));
        await loadClientKeys();
      } catch (e) { notify(e.message, true); }
    };

    function toLocalDatetimeInputVal(isoStr) {
      if (!isoStr) return "";
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    window.setCkMaxConc = (v) => { $("ckMaxConcInput").value = v === "" ? "" : String(v); };
    window.setCkMaxReq = (v) => { $("ckMaxReqInput").value = v === "" ? "" : String(v); };
    window.setCkExpDays = (days) => {
      days = Number(days);
      if (!days) { $("ckExpiresInput").value = ""; return; }
      const target = new Date(Date.now() + days * 86400 * 1000);
      $("ckExpiresInput").value = toLocalDatetimeInputVal(target.toISOString());
    };

    function renderClientKeysTable() {
      $("clientKeysBody").innerHTML = clientKeysCache.length ? clientKeysCache.map((k) => {
        const scopeHtml = k.allowAllModels
          ? '<span class="tag tag-ok">' + esc(tr("跟随全局已启用模型 (不限)", "All enabled models")) + '</span>'
          : ('<div><span class="tag tag-warn">' + esc(tr("仅限指定 " + k.allowedModels.length + " 个模型", k.allowedModels.length + " models allowed")) + '</span>' +
             '<div class="mono" style="font-size:11px;color:var(--fg-muted);margin-top:3px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(k.allowedModels.join(", ")) + '">' +
               esc(k.allowedModels.join(", ")) +
             '</div></div>');

        const st = k.stats || {};
        const reqLimitStr = k.maxRequests != null
          ? (tr('已用 ', 'Used ') + fmt(st.requests) + ' / ' + fmt(k.maxRequests) + tr(' 次', ' reqs'))
          : (tr('已用 ', 'Used ') + fmt(st.requests) + tr(' 次 (无上限)', ' reqs (unlimited)'));
        const expStr = k.expiresAt
          ? (k.isExpired ? (tr('已于 ', 'Expired ') + new Date(k.expiresAt).toLocaleString() + tr(' 过期', '')) : (tr('至 ', 'Until ') + new Date(k.expiresAt).toLocaleString()))
          : tr('永不过期', 'Never expires');

        const limitColor = (k.isExpired || k.isQuotaExhausted) ? 'var(--err)' : 'var(--fg)';
        const limitHtml = '<div style="color:' + limitColor + ';font-size:12px;">' +
          '<div style="font-size:11px;color:var(--fg-muted);">' + esc(tr('并发 ', 'Concurrency ')) + (k.maxConcurrent != null ? esc(k.maxConcurrent) : esc(tr('不限', 'Unlimited'))) + '</div>' +
          '<div class="mono">' + esc(reqLimitStr) + (k.isQuotaExhausted ? ' <span class="tag" style="color:var(--err);border-color:var(--err);">' + esc(tr('次数耗尽', 'Exhausted')) + '</span>' : '') + '</div>' +
          '<div style="font-size:11px;color:' + (k.isExpired ? 'var(--err)' : 'var(--fg-muted)') + ';">' + esc(expStr) + '</div>' +
        '</div>';

        const lastTime = st.lastUsedAt ? new Date(st.lastUsedAt).toLocaleString() : tr("尚未使用", "Never used");
        return '<tr class="' + ((!k.enabled || k.isExpired || k.isQuotaExhausted) ? 'row-disabled' : '') + '">' +
          '<td><label class="switch"><input type="checkbox" ' + (k.enabled ? 'checked' : '') + ' data-change="toggleCkEnabled" data-arg="' + esc(k.id) + '" /><span class="slider"></span></label></td>' +
          '<td style="font-weight:500;">' + esc(k.name) + '</td>' +
          '<td><span class="mono">' + esc(k.maskedToken) + '</span> <button class="btn-xs" style="margin-left:6px;" data-click="copyCkToken" data-arg="' + esc(k.id) + '">' + esc(tr('复制', 'Copy')) + '</button></td>' +
          '<td>' + scopeHtml + '</td>' +
          '<td>' + limitHtml + '</td>' +
          '<td class="mono" style="font-size:11.5px;"><div>' + esc(tr('入 ', 'In ')) + fmtTok(st.inputTokens) + esc(tr(' / 出 ', ' / Out ')) + fmtTok(st.outputTokens) + '</div><div style="color:var(--fg-muted);">' + esc(lastTime) + '</div></td>' +
          '<td class="ops-cell"><div class="ops-stack">' +
            '<button class="btn-xs" data-click="openEditCkModal" data-arg="' + esc(k.id) + '">' + esc(tr('编辑配置', 'Edit')) + '</button>' +
            (k.maxRequests != null && st.requests > 0 ? '<button class="btn-xs" data-click="resetCkUsedCount" data-arg="' + esc(k.id) + '">' + esc(tr('重置次数', 'Reset')) + '</button>' : '') +
            '<button class="btn-xs btn-danger" data-click="deleteCk" data-arg="' + esc(k.id) + '">' + esc(tr('删除', 'Delete')) + '</button>' +
          '</div></td>' +
        '</tr>';
      }).join("") : '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:24px;">' + esc(tr("暂无网关密钥", "No sub-keys")) + '</td></tr>';
    }

    function renderCkChecklist() {
      const kw = $("ckModelSearch").value.trim().toLowerCase();
      const list = modelsCatalogCache.filter((m) =>
        !kw || m.id.toLowerCase().includes(kw) || (m.displayName || "").toLowerCase().includes(kw)
      );
      $("ckPickedCountLabel").textContent = tr("已选 ", "Picked ") + ckPickedModels.size + " / " + modelsCatalogCache.length;

      $("ckModelsChecklist").innerHTML = list.length ? list.map((m) => {
        const isChecked = ckPickedModels.has(m.id);
        const checkedAttr = isChecked ? "checked" : "";
        const pBadge = m.pool === "auto"
          ? '<span class="tag tag-ok" style="flex-shrink:0;white-space:nowrap;">' + esc(tr("Auto池", "Auto")) + '</span>'
          : '<span class="tag" style="flex-shrink:0;white-space:nowrap;">' + esc(tr("API池", "API")) + '</span>';
        return '<label class="ck-card ' + (isChecked ? 'picked' : '') + '">' +
          '<input type="checkbox" style="flex-shrink:0;" ' + checkedAttr + ' data-change="onCkModelTick" data-arg="' + esc(m.id) + '" />' +
          '<div class="ck-card-info">' +
            '<div class="ck-card-id mono" title="' + esc(m.id) + '">' + esc(m.id) + '</div>' +
            '<div class="ck-card-name" title="' + esc(m.displayName) + '">' + esc(m.displayName) + '</div>' +
          '</div>' +
          pBadge +
        '</label>';
      }).join("") : '<div style="grid-column:1/-1;color:var(--fg-muted);padding:16px;text-align:center;font-size:12px;">' + esc(tr("无匹配模型", "No matching models")) + '</div>';
    }

    window.onCkModelTick = (id, checked) => {
      if (checked) ckPickedModels.add(id);
      else ckPickedModels.delete(id);
      renderCkChecklist();
    };

    $("ckScopeSelect").onchange = () => {
      $("ckModelsPickerWrap").style.display = $("ckScopeSelect").value === "custom" ? "block" : "none";
      if ($("ckScopeSelect").value === "custom") renderCkChecklist();
    };
    $("ckModelSearch").oninput = renderCkChecklist;
    $("ckPickAutoBtn").onclick = () => {
      ckPickedModels.clear();
      modelsCatalogCache.filter((m) => m.pool === "auto").forEach((m) => ckPickedModels.add(m.id));
      renderCkChecklist();
    };
    $("ckPickGrokBtn").onclick = () => {
      ckPickedModels.clear();
      modelsCatalogCache.filter((m) => m.id.includes("grok")).forEach((m) => ckPickedModels.add(m.id));
      renderCkChecklist();
    };
    $("ckPickAllBtn").onclick = () => {
      modelsCatalogCache.forEach((m) => ckPickedModels.add(m.id));
      renderCkChecklist();
    };
    $("ckPickNoneBtn").onclick = () => {
      ckPickedModels.clear();
      renderCkChecklist();
    };

    $("openCreateCkModalBtn").onclick = async () => {
      if (modelsCatalogCache.length === 0) await loadModelsCatalog();
      editingCkId = null;
      $("ckModalTitle").textContent = tr("创建网关子密钥", "Create Client Sub-Key");
      $("ckNameInput").value = "";
      $("ckTokenInput").value = "";
      $("ckMaxReqInput").value = "";
      $("ckMaxConcInput").value = "";
      $("ckExpiresInput").value = "";
      $("ckTokenFieldWrap").style.display = "block";
      $("ckScopeSelect").value = "custom";
      ckPickedModels.clear();
      modelsCatalogCache.filter((m) => m.pool === "auto").forEach((m) => ckPickedModels.add(m.id));
      $("ckModelsPickerWrap").style.display = "block";
      renderCkChecklist();
      $("clientKeyModal").classList.add("open");
    };

    window.openEditCkModal = async (id) => {
      if (modelsCatalogCache.length === 0) await loadModelsCatalog();
      const found = clientKeysCache.find((k) => k.id === id);
      if (!found) return;
      editingCkId = id;
      $("ckModalTitle").textContent = tr("编辑子密钥权限与配额 · ", "Edit Sub-Key · ") + found.name;
      $("ckNameInput").value = found.name;
      $("ckMaxReqInput").value = found.maxRequests != null ? String(found.maxRequests) : "";
      $("ckMaxConcInput").value = found.maxConcurrent != null ? String(found.maxConcurrent) : "";
      $("ckExpiresInput").value = toLocalDatetimeInputVal(found.expiresAt);
      $("ckTokenFieldWrap").style.display = "none";
      $("ckScopeSelect").value = found.allowAllModels ? "all" : "custom";
      ckPickedModels.clear();
      (found.allowedModels || []).forEach((m) => ckPickedModels.add(m));
      $("ckModelsPickerWrap").style.display = found.allowAllModels ? "none" : "block";
      renderCkChecklist();
      $("clientKeyModal").classList.add("open");
    };

    window.closeCkModal = () => { $("clientKeyModal").classList.remove("open"); };

    $("saveCkModalBtn").onclick = async () => {
      const name = $("ckNameInput").value.trim() || tr("网关子密钥", "Sub-Key");
      const allowAllModels = $("ckScopeSelect").value === "all";
      const allowedModels = [...ckPickedModels];
      const maxReqRaw = $("ckMaxReqInput").value.trim();
      const maxRequests = maxReqRaw ? Number(maxReqRaw) : null;
      const maxConcRaw = $("ckMaxConcInput").value.trim();
      const maxConcurrent = maxConcRaw ? Number(maxConcRaw) : null;
      const expRaw = $("ckExpiresInput").value.trim();
      const expiresAt = expRaw ? new Date(expRaw).toISOString() : null;

      if (!allowAllModels && allowedModels.length === 0) {
        return notify(tr("自定义模型白名单模式下，请至少勾选 1 个模型。", "Select at least one model under custom allowlist mode."), true);
      }
      $("saveCkModalBtn").disabled = true;
      try {
        if (editingCkId) {
          await api("/v1/admin/client-keys/" + editingCkId, {
            method: "PATCH",
            body: JSON.stringify({ name, allowAllModels, allowedModels, maxRequests, maxConcurrent, expiresAt })
          });
          notify(tr("已保存密钥 「" + name + "」 的权限与有效期配置。", "Saved sub-key '" + name + "'."));
        } else {
          const customToken = $("ckTokenInput").value.trim();
          const created = await api("/v1/admin/client-keys", {
            method: "POST",
            body: JSON.stringify({
              name,
              customToken: customToken || undefined,
              allowAllModels,
              allowedModels,
              maxRequests,
              maxConcurrent,
              expiresAt
            })
          });
          notify(tr("已创建子密钥 「" + name + "」: ", "Created sub-key '" + name + "': ") + created.rawToken);
        }
        closeCkModal();
        await loadClientKeys();
      } catch (e) { notify(e.message, true); }
      finally { $("saveCkModalBtn").disabled = false; }
    };

    window.toggleCkEnabled = async (id, enabled) => {
      try {
        await api("/v1/admin/client-keys/" + id, { method: "PATCH", body: JSON.stringify({ enabled }) });
        await loadClientKeys();
      } catch (e) { notify(e.message, true); await loadClientKeys(); }
    };

    window.deleteCk = async (id) => {
      if (!confirm(tr("确定删除这把网关子密钥吗？使用该密钥的外部客户端将立即无法访问。", "Delete this sub-key? Clients using it will lose access immediately."))) return;
      try {
        await api("/v1/admin/client-keys/" + id, { method: "DELETE" });
        await loadClientKeys();
      } catch (e) { notify(e.message, true); }
    };

    // ==================== CORE CONSOLE DATA & AUTH ====================
    async function loadConsoleData(querySuffix = "") {
      const syncBtns = Array.from(document.querySelectorAll("[data-sync-quota]"));
      syncBtns.forEach((b) => {
        b.disabled = true;
        b.textContent = querySuffix ? tr("同步中...", "Syncing...") : tr("加载中...", "Loading...");
      });
      try {
        const data = await api(querySuffix ? ("/v1/quota" + querySuffix) : "/v1/usage");
        renderAll(data);
        await Promise.all([fetchLogs(), loadClientKeys(), loadOverview()]);
        if (modelsCatalogCache.length === 0) void loadModelsCatalog();
      } catch (e) {
        if ($("appShell").style.display !== "none") notify(e.message, true);
      } finally {
        syncBtns.forEach((b) => {
          b.disabled = false;
          b.textContent = tr("同步最新额度", "Sync Quotas");
        });
      }
    }

    $("loginForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const pwd = $("loginPwdInput").value.trim();
      if (!pwd) return;
      $("loginSubmitBtn").disabled = true;
      $("loginErrText").textContent = "";
      try {
        const res = await fetch(basePath + "/v1/admin/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Console-CSRF": "1", "X-Console-Lang": currentLang },
          body: JSON.stringify({ password: pwd })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data.error && data.error.message) || tr("密码错误", "Invalid password"));
        if (data.token) {
          sessionBearer = data.token;
          sessionStorage.setItem("cgw_session_bearer", data.token);
        }
        $("loginPwdInput").value = "";
        showConsole();
        await loadConsoleData("");
      } catch (err) {
        $("loginErrText").textContent = err.message;
      } finally {
        $("loginSubmitBtn").disabled = false;
      }
    };

    $("changePwdBtn").onclick = async () => {
      const next = prompt(tr("请输入新的后台管理员密码（至少 8 位）：", "Enter new admin password (min 8 chars):"));
      if (!next) return;
      if (next.trim().length < 8) {
        notify(tr("新管理密码长度至少为 8 位。", "New admin password must be at least 8 characters."), true);
        return;
      }
      try {
        const res = await api("/v1/admin/password", {
          method: "POST",
          body: JSON.stringify({ newPassword: next })
        });
        if (res.token) {
          sessionBearer = res.token;
          sessionStorage.setItem("cgw_session_bearer", res.token);
        }
        notify(tr("后台管理员密码已修改并持久化保存。", "Admin password updated and saved."));
      } catch (e) { notify(e.message, true); }
    };

    $("logoutBtn").onclick = async () => {
      await fetch(basePath + "/v1/admin/logout", { method: "POST", credentials: "same-origin", headers: { "X-Console-CSRF": "1" } }).catch(() => {});
      sessionBearer = "";
      sessionStorage.removeItem("cgw_session_bearer");
      showLoginGate();
    };

    document.querySelectorAll("[data-sync-quota]").forEach((b) => { b.onclick = () => loadConsoleData("?force=1"); });

    window.toggleKey = async (slotId, enabled) => {
      try {
        await api("/v1/admin/keys/" + slotId, { method: "PATCH", body: JSON.stringify({ enabled }) });
        await loadConsoleData(enabled ? "?force=1" : "");
      } catch (e) { notify(e.message, true); await loadConsoleData(""); }
    };

    window.editLabel = async (slotId, cur) => {
      const next = prompt(tr("设置凭证备注名称（留空清除）：", "Set key label (leave blank to clear):"), cur || "");
      if (next === null) return;
      try {
        await api("/v1/admin/keys/" + slotId, { method: "PATCH", body: JSON.stringify({ label: next }) });
        await loadConsoleData("");
      } catch (e) { notify(e.message, true); }
    };

    window.recheckKey = async (slotId) => {
      try {
        const r = await api("/v1/admin/keys/" + slotId + "/recheck", { method: "POST", body: "{}" });
        notify(r.recovered ? tr("重新检测通过，已恢复调度。", "Recheck passed; scheduling resumed.") : (tr("重新检测后仍不可用：", "Still unavailable: ") + ((r.slot && r.slot.autoDisabledReason) || tr("请查看状态说明", "Check status"))), !r.recovered);
        await loadConsoleData("?force=1");
      } catch (e) { notify(e.message, true); }
    };

    window.clearKeyCd = async (slotId) => {
      try {
        await api("/v1/admin/keys/" + slotId, { method: "PATCH", body: JSON.stringify({ clearCooldown: true }) });
        await loadConsoleData("");
      } catch (e) { notify(e.message, true); }
    };

    window.deleteKey = async (slotId) => {
      if (!confirm(tr("确认从网关移除该 API Key 凭证？", "Remove this Cursor API Key from the pool?"))) return;
      try {
        await api("/v1/admin/keys/" + slotId, { method: "DELETE" });
        await loadConsoleData("");
      } catch (e) { notify(e.message, true); }
    };

    document.querySelectorAll("[data-open-add-modal]").forEach((b) => { b.onclick = () => { $("addModal").classList.add("open"); $("modalKeysInput").focus(); }; });
    if ($("ovViewAllLogsBtn")) $("ovViewAllLogsBtn").onclick = () => switchTab("logs");
    if ($("onboardToKeysBtn")) $("onboardToKeysBtn").onclick = () => switchTab("clientkeys");
    window.closeAddModal = () => { $("addModal").classList.remove("open"); resetSessionBox(); };
    $("confirmAddKeyBtn").onclick = async () => {
      const lines = $("modalKeysInput").value.split(/\\r?\\n|,/).map((s) => s.trim()).filter(Boolean);
      if (!lines.length) {
        if ($("modalSessionInput").value.trim()) {
          notify(tr("SessionToken 导入请点击上方「检查该账号已有 Key」或「确认创建新 Key 并导入」。", "For SessionToken, click Check Existing Keys or Create & Import above."), true);
        } else {
          notify(tr("请先粘贴至少一把 crsr_ API Key。", "Paste at least one crsr_ API Key first."), true);
        }
        return;
      }
      const label = $("modalLabelInput").value.trim();
      const enabled = $("modalEnabledSelect").value === "true";
      $("confirmAddKeyBtn").disabled = true;
      try {
        for (let i = 0; i < lines.length; i++) {
          const itemLabel = lines.length > 1 && label ? (label + " #" + (i + 1)) : label;
          await api("/v1/admin/keys", {
            method: "POST",
            body: JSON.stringify({ apiKey: lines[i], enabled, label: itemLabel })
          });
        }
        $("modalKeysInput").value = "";
        $("modalLabelInput").value = "";
        closeAddModal();
        notify(tr("成功导入 " + lines.length + " 把凭证。", "Imported " + lines.length + " key(s)."));
        await loadConsoleData(enabled ? "?force=1" : "");
      } catch (e) {
        notify(e.message, true);
      } finally {
        $("confirmAddKeyBtn").disabled = false;
      }
    };

    window.toggleOnDemand = async (slotId, mode) => {
      const tip = mode === "off"
        ? tr("关闭 On-Demand 超额：该账号额度用尽后将不再产生按需扣费。确认？", "Disable On-Demand overage spending for this account?")
        : tr("开启 On-Demand 超额：额度用尽后将按量计费，可能产生真实费用。确认？", "Enable On-Demand overage spending? Charges may apply after included quota runs out.");
      if (!confirm(tip)) return;
      try {
        const r = await api("/v1/admin/keys/" + slotId + "/on-demand", { method: "POST", body: JSON.stringify({ mode }) });
        notify(tr("On-Demand 已", "On-Demand ") + (r.onDemand.enabled ? tr("开启", "enabled") : tr("关闭", "disabled")));
        await loadConsoleData("?force=1");
      } catch (e) { notify(e.message, true); }
    };

    function sessionTokenValue() { return $("modalSessionInput").value.trim(); }
    function resetSessionBox() {
      $("modalSessionInput").value = "";
      $("sessionPreview").style.display = "none";
      $("sessionPreview").textContent = "";
      $("sessionCreateBtn").style.display = "none";
    }
    $("sessionCheckBtn").onclick = async () => {
      const tok = sessionTokenValue();
      if (!tok) return;
      $("sessionCheckBtn").disabled = true;
      try {
        const r = await api("/v1/admin/session-token/list-keys", { method: "POST", body: JSON.stringify({ sessionToken: tok }) });
        const box = $("sessionPreview");
        const list = r.apiKeys || [];
        box.style.display = "block";
        box.innerHTML = (list.length
          ? (tr('该账号已有 ' + list.length + ' 把 Key（仅显示掩码，无法导入）：', 'Found ' + list.length + ' masked key(s) on this account (cannot import directly):') + '<ul style="margin:4px 0 4px 18px;">' + list.map((k) => '<li>' + esc(k.name || tr("未命名", "Unnamed")) + ' <span class="mono">' + esc(k.maskedKey) + '</span></li>').join("") + '</ul>' + esc(tr('如需入池，可新建一把专用 Key。', 'Click below to create and import a dedicated key.')))
          : esc(tr('该账号还没有任何 API Key，可新建一把并入池。', 'No API keys found on this account yet; click below to create one.')));
        $("sessionCreateBtn").style.display = "inline-block";
      } catch (e) { notify(e.message, true); }
      finally { $("sessionCheckBtn").disabled = false; }
    };
    $("sessionCreateBtn").onclick = async () => {
      const tok = sessionTokenValue();
      if (!tok) return;
      if (!confirm(tr("将在该 Cursor 账号下新建一把 API Key 并加入网关，确认？", "Create a new API Key on this Cursor account and add it to the pool?"))) return;
      $("sessionCreateBtn").disabled = true;
      try {
        const label = $("modalLabelInput").value.trim();
        await api("/v1/admin/session-token/create-key", { method: "POST", body: JSON.stringify({ sessionToken: tok, confirm: true, name: label || undefined }) });
        resetSessionBox();
        closeAddModal();
        notify(tr("已创建新 Key 并加入凭证池。", "Created and imported new key."));
        await loadConsoleData("?force=1");
      } catch (e) { notify(e.message, true); }
      finally { $("sessionCreateBtn").disabled = false; }
    };

    $("cfgAllowNativeWebTools").onchange = async () => {
      const wantOn = $("cfgAllowNativeWebTools").checked;
      if (wantOn) {
        const ok = confirm(tr(
          "安全与费用风险提示：\\n\\n1. 每次搜索/抓取都会额外消耗你的 Cursor 上游账号额度与工具轮次；\\n2. 调用方可通过 web_fetch 以你的 Cursor 账号身份访问任意外部 URL；\\n3. 部分 CLI 客户端（如 Claude Code）并不期望网关自动替它执行云端搜索。\\n\\n仅建议单人自用或完全可信环境开启，公网共享请保持关闭。确定要开启吗？",
          "Security & Quota Warning:\\n\\n1. Every search/fetch consumes extra Cursor account quota and tool turns;\\n2. Callers can use web_fetch to access arbitrary external URLs under your Cursor account;\\n3. Some CLI clients (e.g. Claude Code) do not expect the gateway to run cloud search automatically.\\n\\nRecommended only for single-user or trusted environments. Enable now?"
        ));
        if (!ok) {
          $("cfgAllowNativeWebTools").checked = false;
          return;
        }
      }
      try {
        await api("/v1/admin/settings", {
          method: "POST",
          body: JSON.stringify({ allowNativeWebTools: wantOn })
        });
        notify(wantOn
          ? tr("已热更新开启 Cursor 云端联网工具（仅限可信环境）。", "Native web tools hot-enabled (trusted environments only).")
          : tr("已热更新关闭 Cursor 云端联网工具。", "Native web tools hot-disabled."));
      } catch (e) {
        $("cfgAllowNativeWebTools").checked = !wantOn;
        notify(e.message, true);
      }
    };

    $("saveRoutingBtn").onclick = async () => {
      try {
        await api("/v1/admin/settings", {
          method: "POST",
          body: JSON.stringify({
            lbStrategy: $("cfgLbStrategy").value,
            sessionAffinityEnabled: $("cfgAffinityEnabled").checked,
            sessionAffinityTtlSeconds: Number($("cfgAffinityTtl").value) || 3600,
            autoDisableExhaustedKeys: $("cfgAutoDisable").checked,
            allowNativeWebTools: $("cfgAllowNativeWebTools").checked
          })
        });
        notify(tr("路由、粘性亲和与熔断策略已保存生效。", "Routing, affinity, and circuit-breaker settings saved."));
        await loadConsoleData("");
      } catch (e) { notify(e.message, true); }
    };

    $("clearAffinityBtn").onclick = async () => {
      try {
        await api("/v1/admin/affinity/clear", { method: "POST", body: "{}" });
        notify(tr("已清空活跃会话亲和绑定表。", "Active sticky session bindings cleared."));
        await loadConsoleData("");
      } catch (e) { notify(e.message, true); }
    };

    $("pgSendBtn").onclick = async () => {
      const model = $("pgModel").value;
      const promptText = $("pgPrompt").value.trim();
      if (!promptText) return;
      $("pgSendBtn").disabled = true;
      $("pgOutput").textContent = tr("请求调度中...", "Dispatching request...");
      const t0 = performance.now();
      try {
        const res = await api("/v1/admin/playground", {
          method: "POST",
          body: JSON.stringify({ model, prompt: promptText })
        });
        const dt = ((performance.now() - t0) / 1000).toFixed(2);
        const msg = ((res.choices || [])[0] || {}).message || {};
        $("pgOutput").textContent =
          tr("耗时: ", "Duration: ") + dt + tr("s | 模型: ", "s | Model: ") + res.model + "\\n" +
          (msg.reasoning_content ? (tr("思考: ", "Thinking: ") + msg.reasoning_content.trim() + "\\n\\n") : "") +
          tr("回复: ", "Reply: ") + (msg.content || "") + "\\n\\n" +
          tr("Token 统计: ", "Usage: ") + JSON.stringify(res.usage || {});
        await loadConsoleData("");
      } catch (e) {
        $("pgOutput").textContent = tr("请求失败: ", "Request failed: ") + e.message;
      } finally {
        $("pgSendBtn").disabled = false;
      }
    };

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (openTraceId) closeTraceDrawer();
      else if ($("addModal").classList.contains("open")) window.closeAddModal();
      else if ($("clientKeyModal").classList.contains("open")) window.closeCkModal();
    });

    // CSP-safe event delegation (replaces inline onclick/onchange attributes).
    function dispatchDataAction(ev, attr) {
      const el = ev.target.closest("[data-" + attr + "]");
      if (!el) return;
      const fn = window[el.getAttribute("data-" + attr)];
      if (typeof fn !== "function") return;
      if (el.hasAttribute("data-pass")) { fn(el); return; }
      if (el.hasAttribute("data-arg2")) { fn(el.dataset.arg, el.dataset.arg2); return; }
      if (attr === "change") { fn(el.dataset.arg, el.checked); return; }
      if (el.hasAttribute("data-arg")) { fn(el.dataset.arg); return; }
      fn();
    }
    document.addEventListener("click", (ev) => {
      const self = ev.target.closest("[data-click-self]");
      if (self && ev.target === self) { const f = window[self.getAttribute("data-click-self")]; if (typeof f === "function") f(); return; }
      if (ev.target.closest("input,label")) return;
      dispatchDataAction(ev, "click");
    });
    document.addEventListener("change", (ev) => dispatchDataAction(ev, "change"));

    applyLang(currentLang);

    (async () => {
      try {
        const st = await fetch(basePath + "/v1/admin/session", {
          credentials: "same-origin",
          headers: Object.assign({ "X-Console-Lang": currentLang }, sessionBearer ? { Authorization: "Bearer " + sessionBearer } : {})
        });
        if (st.ok) {
          showConsole();
          await loadConsoleData("");
        } else {
          showLoginGate();
        }
      } catch {
        showLoginGate();
      }
    })();
  </script>
</body>
</html>`;
}
