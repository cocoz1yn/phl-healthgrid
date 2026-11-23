(() => {
  const endpoint = "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/DOR_Parcel/FeatureServer/0/query";
  const offset = [470000, 4400000]; // Basemap origin in EPSG:26918.

  window.createParcelLayer = ({ redraw, report }) => {
    let path;
    let coverage;
    let pending;
    let timer;
    let failedView;
    let loadedStatus;

    function cancel() {
      clearTimeout(timer);
      pending?.abort();
      pending = null;
    }

    function update(view) {
      if (!view) {
        cancel();
        failedView = null;
        return;
      }
      const [west, south, east, north] = view;
      if (coverage && west >= coverage[0] && south >= coverage[1]
          && east <= coverage[2] && north <= coverage[3]) {
        if (pending) cancel();
        report(loadedStatus);
        return;
      }

      const key = view.map(value => Math.round(value / 80)).join(",");
      if (pending?.key === key || failedView === key) return;
      cancel();
      const request = new AbortController();
      request.key = key;
      pending = request;
      report("Loading parcels…");
      timer = setTimeout(async () => {
        const bounds = [west - 180, south - 180, east + 180, north + 180];
        const [x0, y0, x1, y1] = bounds.map((value, i) => Math.round(value + offset[i % 2]));
        const params = new URLSearchParams({
          f: "json",
          where: "status=1",
          geometry: [x0, y0, x1, y1].join(","),
          geometryType: "esriGeometryEnvelope",
          spatialRel: "esriSpatialRelIntersects",
          inSR: "26918",
          outSR: "26918",
          outFields: "objectid",
          orderByFields: "objectid",
          resultRecordCount: "2000",
          returnGeometry: "true",
        });
        const nextPath = new Path2D();
        try {
          let start = 0;
          let page;
          do {
            params.set("resultOffset", start);
            const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12000)]);
            const response = await fetch(`${endpoint}?${params}`, { signal });
            if (!response.ok) throw new Error("Parcel service unavailable");
            page = await response.json();
            if (!Array.isArray(page.features)) throw new Error("Unexpected parcel response");
            for (const feature of page.features) {
              for (const ring of feature.geometry?.rings ?? []) {
                if (ring.length < 4) continue;
                nextPath.moveTo(ring[0][0] - offset[0], ring[0][1] - offset[1]);
                for (const [x, y] of ring.slice(1)) nextPath.lineTo(x - offset[0], y - offset[1]);
                nextPath.closePath();
              }
            }
            start += page.features.length;
            if (page.exceededTransferLimit && !page.features.length) throw new Error("Incomplete parcel response");
          } while (page.exceededTransferLimit);
          if (pending !== request) return;
          path = nextPath;
          coverage = bounds;
          failedView = null;
          loadedStatus = start ? "Parcel boundaries visible" : "No parcels in this view";
          report(loadedStatus);
          redraw();
        } catch {
          if (pending !== request) return;
          failedView = key;
          report("Parcels unavailable. Pan or toggle Parcels to retry.");
        } finally {
          if (pending === request) pending = null;
        }
      }, 250);
    }

    return {
      update,
      get path() { return path; },
    };
  };
})();
