/** CSS bersama untuk UI input (kalibrasi, PIP kamera, chip pelacakan). Disuntikkan sekali. */
export const SHELL_CSS = `
:root{--mi-panel:rgba(14,18,40,.72);--mi-line:rgba(120,150,255,.22);--mi-dim:#8b97b8;--mi-gold:#ffc24d;--mi-text:#eaf0ff}
#mi-pip{position:fixed;left:14px;bottom:14px;width:min(26vw,240px);border-radius:12px;border:1px solid var(--mi-line);box-shadow:0 8px 30px rgba(0,0,0,.5);display:none;background:#000;z-index:4}
#mi-pip.large{width:min(92vw,720px);left:50%;bottom:auto;top:90px;transform:translateX(-50%);cursor:crosshair;z-index:20}
#mi-chip{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);padding:7px 14px;border-radius:999px;background:var(--mi-panel);border:1px solid rgba(255,194,77,.4);font:13px system-ui,sans-serif;color:var(--mi-gold);backdrop-filter:blur(8px);display:none;z-index:4}
#mi-calib{position:fixed;left:0;right:0;bottom:0;z-index:21;padding:14px 16px max(16px,env(safe-area-inset-bottom));display:none;background:linear-gradient(transparent,rgba(5,6,16,.92) 30%);font-family:system-ui,sans-serif}
#mi-calib p{text-align:center;color:var(--mi-dim);font-size:13px;margin:0 0 10px}
#mi-calib b{color:var(--mi-text)}
#mi-calib .row{display:flex;gap:8px;flex-wrap:wrap;max-width:720px;margin:0 auto}
#mi-calib button{flex:1 1 150px;padding:11px 12px;border-radius:12px;border:1px solid var(--mi-line);background:var(--mi-panel);color:var(--mi-text);font:600 14px system-ui,sans-serif;cursor:pointer}
#mi-calib button:hover{border-color:rgba(47,227,255,.6)}
#mi-calib button.on{outline:2px solid var(--mi-gold)}
#mi-calib button.primary{background:linear-gradient(90deg,#1d6cff,#8f2bff);border-color:transparent}
`;
