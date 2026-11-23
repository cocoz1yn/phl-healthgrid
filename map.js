(() => {
  const data = window.PHL_BASEMAP;
  const parcelScale = 0.58;
  const zoomDuration = 165;
  const priorityAreas = new Set([
    "Center City", "University City", "West Philadelphia", "South Philadelphia",
    "North Philadelphia", "Northeast Philadelphia", "Far Northeast Philadelphia",
    "Northwest Philadelphia", "Southwest Philadelphia", "River Wards",
  ]);
  const places = [...data.labels].sort((a, b) => Number(priorityAreas.has(b[2])) - Number(priorityAreas.has(a[2])));

  function makePath(groups, closed = false) {
    const path = new Path2D();
    for (const points of groups) {
      path.moveTo(...points[0]);
      for (const point of points.slice(1)) path.lineTo(...point);
      if (closed) path.closePath();
    }
    return path;
  }

  window.createHealthMap = ({ canvas, onSelect, onParcelStatus }) => {
    const context = canvas.getContext("2d");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const paths = Object.fromEntries(
      Object.entries(data.layers).map(([name, groups]) => [
        name,
        makePath(groups, name === "water" || name === "parks"),
      ])
    );
    const city = makePath(data.city, true);
    const parcels = window.createParcelLayer({ redraw: requestDraw, report: onParcelStatus });
    const cityPoints = data.city.flat();
    const xs = cityPoints.map(([x]) => x);
    const ys = cityPoints.map(([, y]) => y);
    const cityBounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const [left, bottom, right, top] = data.bounds;
    const [cityLeft, cityBottom, cityRight, cityTop] = cityBounds;
    const home = [(cityLeft + cityRight) / 2, (cityTop + cityBottom) / 2];
    let [centerX, centerY] = home;
    let scale, homeScale, width, height, pixelRatio;
    let markers = [];
    let selectedId;
    let zoomTransition;
    let frame = 0;
    const pointers = new Map();
    let moved = false;
    let start;

    function screen([x, y]) {
      return [width / 2 + (x - centerX) * scale, height / 2 - (y - centerY) * scale];
    }

    function requestDraw() {
      if (!frame) frame = requestAnimationFrame(draw);
    }

    function constrain() {
      centerX = Math.max(left, Math.min(right, centerX));
      centerY = Math.max(bottom, Math.min(top, centerY));
    }

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (!width || !height) return;
      pixelRatio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      const fit = Math.min(width / (cityRight - cityLeft), height / (cityTop - cityBottom)) * 0.88;
      zoomTransition = null;
      scale = homeScale ? fit * (scale / homeScale) : fit;
      homeScale = fit;
      requestDraw();
    }

    function draw(now) {
      frame = 0;
      if (!scale) return;
      if (zoomTransition) {
        const { from, to, started } = zoomTransition;
        const progress = Math.max(0, Math.min(1, (now - started) / zoomDuration));
        const ease = 1 - (1 - progress) ** 3;
        centerX = from.x + (to.x - from.x) * ease;
        centerY = from.y + (to.y - from.y) * ease;
        // Interpolate distance per pixel so the point under the cursor stays fixed.
        scale = 1 / ((1 - ease) / from.scale + ease / to.scale);
        if (progress === 1) zoomTransition = null;
        else requestDraw();
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = "#e2e8e8";
      context.fillRect(0, 0, width, height);
      context.setTransform(
        pixelRatio * scale, 0, 0, -pixelRatio * scale,
        pixelRatio * (width / 2 - centerX * scale),
        pixelRatio * (height / 2 + centerY * scale)
      );
      context.lineCap = "round";
      context.lineJoin = "round";
      context.fillStyle = "#f2f4ef";
      context.fill(city);
      context.fillStyle = "#d4e3d2";
      context.fill(paths.parks);
      context.fillStyle = "#bed3de";
      context.fill(paths.water);

      function stroke(path, color, pixels) {
        context.strokeStyle = color;
        context.lineWidth = pixels / scale;
        context.stroke(path);
      }
      const viewWidth = width / (2 * scale);
      const viewHeight = height / (2 * scale);
      const view = [centerX - viewWidth, centerY - viewHeight, centerX + viewWidth, centerY + viewHeight];
      const showParcels = scale >= parcelScale;
      if (!zoomTransition) {
        parcels.update(showParcels ? view : null);
        if (!showParcels) onParcelStatus("");
      }
      if (showParcels && parcels.path) stroke(parcels.path, "#a4aaa0", 0.7);
      stroke(paths.river, "#bfd4de", 0.9);
      if (scale > 0.022) stroke(paths.local, "#ffffff", Math.min(5, scale * 32));
      stroke(paths.collector, "#fff", Math.max(0.6, Math.min(6, scale * 34)));
      stroke(paths.major, "#b6c4c9", Math.max(0.75, Math.min(7, scale * 36)));
      stroke(city, "#78929e", 0.85);

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.textAlign = "center";
      context.textBaseline = "middle";
      const selected = markers.find(({ id }) => id === selectedId);
      const radius = scale >= 0.035 ? 5 : 3.7;
      const overview = scale < 0.034;
      const occupied = scale >= 0.055
        ? markers.map(marker => [...screen(marker.xy), marker === selected ? 11 : 7, 8])
        : selected ? [[...screen(selected.xy), 11, 8]] : [];
      if (overview) {
        for (const marker of markers) {
          if (marker !== selected) drawMarker(marker, radius, false);
        }
      }

      function label(name, x, y, { size, weight, color, angle = 0 }) {
        if (x < 5 || x > width - 5 || y < 10 || y > height - 10) return false;
        context.font = `${weight} ${size}px Arial, sans-serif`;
        const halfText = context.measureText(name).width / 2 + 4;
        const halfHeight = size / 2 + 3;
        const w = Math.abs(Math.cos(angle)) * halfText + Math.abs(Math.sin(angle)) * halfHeight;
        const h = Math.abs(Math.sin(angle)) * halfText + Math.abs(Math.cos(angle)) * halfHeight;
        if (x - w < 3 || x + w > width - 3 || y - h < 1 || y + h > height - 1) return false;
        if (occupied.some(([ox, oy, ow, oh]) => Math.abs(ox - x) < ow + w && Math.abs(oy - y) < oh + h)) return false;
        context.save();
        context.translate(x, y);
        context.rotate(angle);
        context.strokeStyle = "#f8faf8";
        context.lineWidth = 3;
        context.strokeText(name, 0, 0);
        context.fillStyle = color;
        context.fillText(name, 0, 0);
        context.restore();
        occupied.push([x, y, w, h]);
        return true;
      }

      for (const [x, y, name] of places) {
        const area = priorityAreas.has(name);
        if (!area && (scale < 0.04 || name === "Philadelphia")) continue;
        const [sx, sy] = screen([x, y]);
        const style = { size: area ? 12 : 11, weight: 700, color: "#294a54" };
        if (area) [0, -16, 16, -32, 32].some(dy => label(name, sx, sy + dy, style));
        else label(name, sx, sy, style);
      }

      if (scale >= 0.058) {
        for (const [x, y, name, angle, roadClass] of window.PHL_STREET_LABELS) {
          if (x < view[0] || x > view[2] || y < view[1] || y > view[3]) continue;
          if ((roadClass === "local" && scale < 0.26) || (roadClass === "collector" && scale < 0.12)) continue;
          const [sx, sy] = screen([x, y]);
          label(name, sx, sy, { size: 10, weight: 600, color: "#48565a", angle: -angle * Math.PI / 180 });
        }
      }

      if (!overview) {
        for (const marker of markers) {
          if (marker !== selected) drawMarker(marker, radius, false);
        }
      }
      if (selected) drawMarker(selected, 9, true);
    }

    function drawMarker(marker, radius, selected) {
      const [x, y] = screen(marker.xy);
      if (x < -12 || x > width + 12 || y < -12 || y > height + 12) return;
      context.beginPath();
      context.arc(x, y, radius, 0, 2 * Math.PI);
      context.fillStyle = selected ? "#124559" : "#447c8b";
      context.fill();
      context.strokeStyle = "#fff";
      context.lineWidth = selected ? 2.5 : 0.9;
      context.stroke();
      if (selected) {
        context.beginPath();
        context.arc(x, y, 2.7, 0, 2 * Math.PI);
        context.fillStyle = "#fff";
        context.fill();
      }
    }

    function markerAt(x, y) {
      let nearest;
      let distance = 12;
      for (const marker of markers) {
        const [sx, sy] = screen(marker.xy);
        const candidate = Math.hypot(sx - x, sy - y);
        if (candidate <= distance) {
          nearest = marker;
          distance = candidate;
        }
      }
      return nearest;
    }

    function zoomBy(factor, x = width / 2, y = height / 2, animate = true) {
      if (!scale) return;
      const from = { x: centerX, y: centerY, scale };
      const base = zoomTransition?.to ?? from;
      const limit = Math.max(1.45, homeScale * 45);
      const nextScale = Math.min(limit, Math.max(homeScale / 1.25, base.scale * factor));
      if (nextScale === base.scale) return;
      const shift = 1 / base.scale - 1 / nextScale;
      const to = {
        x: Math.max(left, Math.min(right, base.x + (x - width / 2) * shift)),
        y: Math.max(bottom, Math.min(top, base.y - (y - height / 2) * shift)),
        scale: nextScale,
      };
      if (animate && !reducedMotion.matches) {
        zoomTransition = { from, to, started: performance.now() };
      } else {
        zoomTransition = null;
        centerX = to.x;
        centerY = to.y;
        scale = to.scale;
      }
      requestDraw();
    }

    function pan(dx, dy) {
      zoomTransition = null;
      centerX -= dx / scale;
      centerY += dy / scale;
      constrain();
      requestDraw();
    }

    function reset() {
      zoomTransition = null;
      [centerX, centerY] = home;
      scale = homeScale;
      requestDraw();
    }

    function localPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    }

    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0 || pointers.size >= 2) return;
      zoomTransition = null;
      const point = localPoint(event);
      if (!pointers.size) {
        moved = false;
        start = point;
      } else {
        moved = true;
      }
      pointers.set(event.pointerId, point);
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", event => {
      const point = localPoint(event);
      const previous = pointers.get(event.pointerId);
      if (!previous) {
        canvas.classList.toggle("over-marker", !pointers.size && Boolean(markerAt(...point)));
        return;
      }
      pointers.set(event.pointerId, point);
      if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
        const oldDistance = Math.hypot(previous[0] - other[0], previous[1] - other[1]);
        const newDistance = Math.hypot(point[0] - other[0], point[1] - other[1]);
        pan((point[0] - previous[0]) / 2, (point[1] - previous[1]) / 2);
        if (oldDistance > 0 && newDistance > 0) {
          zoomBy(newDistance / oldDistance, (point[0] + other[0]) / 2, (point[1] + other[1]) / 2, false);
        }
      } else if (moved || Math.hypot(point[0] - start[0], point[1] - start[1]) > 4) {
        const from = moved ? previous : start;
        moved = true;
        pan(point[0] - from[0], point[1] - from[1]);
      }
    });

    canvas.addEventListener("pointerup", event => {
      if (!pointers.delete(event.pointerId) || moved) return;
      const marker = markerAt(...localPoint(event));
      if (marker) onSelect(marker.id);
    });
    canvas.addEventListener("lostpointercapture", event => pointers.delete(event.pointerId));
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      const steps = Math.max(-120, Math.min(120, pixels));
      zoomBy(Math.exp(-steps * 0.002), ...localPoint(event));
    }, { passive: false });

    canvas.addEventListener("keydown", event => {
      const directions = { ArrowUp: [0, 60], ArrowDown: [0, -60], ArrowLeft: [60, 0], ArrowRight: [-60, 0] };
      if (directions[event.key]) pan(...directions[event.key]);
      else if (event.key === "+" || event.key === "=") zoomBy(1.5);
      else if (event.key === "-") zoomBy(1 / 1.5);
      else if (event.key === "Home") reset();
      else return;
      event.preventDefault();
    });

    resize();
    new ResizeObserver(resize).observe(canvas);
    return {
      update(nextMarkers, nextSelectedId) {
        markers = nextMarkers;
        selectedId = nextSelectedId;
        requestDraw();
      },
      centerOn([x, y]) {
        zoomTransition = null;
        centerX = x;
        centerY = y;
        scale = Math.max(scale, 0.13);
        constrain();
        requestDraw();
      },
      zoomBy,
      reset,
    };
  };
})();
