export const diagramStyles = `
.rst-diagram{display:flex;flex-direction:column;position:relative;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:#111a26;color:#e8edf4;font:12px/1.4 system-ui,sans-serif;isolation:isolate}
.rst-diagram,.rst-diagram *{box-sizing:border-box}
.rst-diagram-toolbar{display:flex;align-items:center;gap:5px;flex:0 0 auto;padding:6px 8px;border-bottom:1px solid #334155;background:#18202b;min-height:38px}
.rst-diagram .rst-diagram-control{font:inherit;color:inherit;background:#253347;border:1px solid #465975;border-radius:4px;padding:2px 9px;cursor:pointer;min-width:28px}
.rst-diagram .rst-diagram-control:hover{background:#30435c}
.rst-diagram-zoom{min-width:38px;font-variant-numeric:tabular-nums;color:#b8c5d6;text-align:center}
.rst-diagram-hint{font-size:10px;color:#9aadc4;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rst-diagram-viewport{position:relative;flex:1 1 0;min-width:0;min-height:0;overflow:hidden;touch-action:none;cursor:grab;background-image:radial-gradient(#334155 1px,transparent 1px);background-size:18px 18px;overscroll-behavior:contain}
.rst-diagram-dragging{cursor:grabbing;user-select:none}
.rst-diagram-scene{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.rst-diagram-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.rst-diagram-edge{fill:none;stroke:#809ab8;stroke-width:1.6}
.rst-diagram-edge.rst-diagram-reference{stroke:#91a0b1;stroke-dasharray:6 5}
.rst-diagram-edge.rst-diagram-context{stroke:#bf9cf5;stroke-dasharray:5 4;stroke-width:2}
.rst-diagram-edge-label{fill:#b8c5d6;font:10px system-ui,sans-serif;paint-order:stroke;stroke:#111a26;stroke-width:4px;stroke-linejoin:round}
.rst-diagram-edge-label.rst-diagram-context{fill:#d3b7ff}
.rst-diagram-card{position:absolute;width:200px;height:84px;border:1px solid #52617a;border-radius:7px;background:#1e2c3d;box-shadow:0 3px 8px #0003;cursor:default}
.rst-diagram-card:hover{border-color:#8aa8c8;background:#26394f}
.rst-diagram-card.rst-diagram-selected{border:2px solid #8fc6ff;background:#284565;box-shadow:0 0 0 3px #8fc6ff30}
.rst-diagram .rst-diagram-select{display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:3px;width:100%;height:100%;padding:8px 10px;text-align:left;font:inherit;color:inherit;background:transparent;border:0;border-radius:6px;cursor:pointer;overflow:hidden}
.rst-diagram .rst-diagram-select:hover{background:transparent}
.rst-diagram-name{font-weight:650;font-size:13px;padding-right:18px}
.rst-diagram-name,.rst-diagram-meta,.rst-diagram-summary{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:14px}
.rst-diagram-meta{font-size:10px;color:#b6c9df}
.rst-diagram-summary{font-size:10px;color:#9aadc4}
.rst-diagram .rst-diagram-toggle{position:absolute;right:5px;top:5px;display:grid;place-items:center;width:23px;height:22px;padding:0;background:#253347;border:1px solid #52617a;border-radius:4px;font:15px/1 system-ui,sans-serif;color:#d1e6ff;cursor:pointer}
.rst-diagram .rst-diagram-toggle:hover{background:#385471}
.rst-diagram .rst-diagram-toggle[hidden]{display:none}
.rst-diagram button:focus-visible{outline:2px solid #c0e1ff;outline-offset:2px}
.rst-diagram-legend{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;flex:0 0 auto;padding:6px 8px;border-top:1px solid #334155;background:#18202b;font-size:10px;color:#b8c5d6}
.rst-diagram-key{display:inline-flex;align-items:center;gap:5px}
.rst-diagram-key::before{content:'';width:20px;border-top:2px solid #809ab8}
.rst-diagram-key.rst-diagram-reference::before{border-top-style:dashed;border-color:#91a0b1}
.rst-diagram-key.rst-diagram-context::before{border-top-style:dashed;border-color:#bf9cf5}
.rst-diagram-limit{color:#f0d59e;margin-left:auto}
.rst-diagram-empty{position:absolute;inset:0;display:grid;place-items:center;color:#9aadc4;pointer-events:none}
.rst-diagram-empty[hidden]{display:none}
@media(max-width:650px){.rst-diagram-hint{display:none}}
`;
