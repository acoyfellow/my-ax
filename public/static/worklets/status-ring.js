registerPaint("status-ring", class {
  static get inputProperties() { return ["--ring-color", "--ring-progress", "--ring-width"]; }
  paint(ctx, size, props) {
    const color = String(props.get("--ring-color") || "").trim() || "#888";
    const raw = parseFloat(String(props.get("--ring-progress") || "1"));
    const progress = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 1));
    const rawWidth = parseFloat(String(props.get("--ring-width") || "2"));
    const width = Number.isFinite(rawWidth) ? rawWidth : 2;
    const radius = Math.max(1, Math.min(size.width, size.height) / 2 - width / 2);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(size.width / 2, size.height / 2, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }
});
