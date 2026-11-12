"""Render panel data from stdin as vector PDFs or a ZIP of separate figures and tables."""
import io
import json
import sys
import textwrap
import zipfile
from datetime import datetime, timezone

import matplotlib
matplotlib.use("Agg")
matplotlib.rcParams.update({"pdf.fonttype": 42, "font.size": 9, "text.parse_math": False})
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.backends.backend_pdf import PdfPages


def figures(panel):
    data = panel["data"]
    kind = data["kind"]
    title = panel["title"]
    # Split crowded charts into readable pages, keeping all supplied observations.
    axis = None
    limit = 15
    if kind == "series":
        axis = "series"
    elif kind in ("bars", "bins"):
        axis, limit = ("items" if kind == "bars" else "bins"), 30
    elif kind == "table" and data.get("plot") in ("row-lines", "grouped-bars"):
        axis = "rows"
    if axis and len(data[axis]) > limit:
        parts = (len(data[axis]) + limit - 1) // limit
        for start in range(0, len(data[axis]), limit):
            part = {**panel, "title": f"{title} ({start // limit + 1}/{parts})",
                    "data": {**data, axis: data[axis][start:start + limit]}}
            yield from figures(part)
        return
    if kind == "table" and data.get("plot") == "column-lines" and len(data["columns"]) > 16:
        for start in range(1, len(data["columns"]), 15):
            indices = [0] + list(range(start, min(start + 15, len(data["columns"]))))
            yield from figures({**panel, "data": {**data, "columns": [data["columns"][i] for i in indices],
                                "rows": [[row[i] for i in indices] for row in data["rows"]]}})
        return
    if kind == "table" and data.get("plot"):
        columns, rows = data["columns"], data["rows"]
        fig, ax = plt.subplots(figsize=(10, 5.5), layout="constrained")
        ax.set_title(textwrap.fill(title, 90))
        plot = data["plot"]
        numeric = lambda values: [float("nan") if v is None else v for v in values]
        if plot == "scatter":
            ax.scatter([r[0] for r in rows], [r[1] for r in rows], s=9, alpha=.5)
            ax.set_xlabel(columns[0])
            ax.set_ylabel(columns[1])
        elif plot == "column-lines":
            for i, label in enumerate(columns[1:], 1):
                ax.plot([r[0] for r in rows], numeric([r[i] for r in rows]), label=label)
            ax.set_xlabel(columns[0])
        else:
            for i, row in enumerate(rows):
                if plot == "row-lines":
                    ax.plot(range(len(columns) - 1), numeric(row[1:]), label=str(row[0]))
                else:
                    width = .8 / max(1, len(rows))
                    ax.bar([j - .4 + width * (i + .5) for j in range(len(columns) - 1)], numeric(row[1:]), width=width, label=str(row[0]))
            ax.set_xticks(range(len(columns) - 1), columns[1:], rotation=30, ha="right", fontsize=7)
        if rows and plot != "scatter":
            ax.legend(fontsize=6, loc="upper left", bbox_to_anchor=(1, 1))
        ax.grid(alpha=.2)
        yield fig
        return
    if kind == "table":
        columns, rows = data["columns"], data["rows"]
        # Paginate both dimensions; no truncation or shrinking a large table to illegibility.
        for col in range(0, len(columns), 6):
            indices = list(range(col, min(col + 6, len(columns))))
            if col:
                indices.insert(0, 0)
            wrap = lambda v: textwrap.fill("" if v is None else str(v), 22)
            header = [wrap(columns[i]) for i in indices]
            header_lines = max(len(v.splitlines()) for v in header)
            wrapped = [[wrap(r[i]) for i in indices] for r in rows] or [[""] * len(indices)]
            pages, page, used = [], [], header_lines + 1
            for row in wrapped:
                height = max(1, *(len(v.splitlines()) for v in row)) + 1
                if page and used + height > 48:
                    pages.append(page)
                    page, used = [], header_lines + 1
                page.append(row)
                used += height
            if page:
                pages.append(page)
            for page in pages:
                fig, ax = plt.subplots(figsize=(11.7, 8.3))
                ax.axis("off")
                ax.set_title(textwrap.fill(title, 95), pad=16)
                table = ax.table(cellText=page, colLabels=header, loc="upper center", cellLoc="left")
                table.auto_set_font_size(False)
                table.set_fontsize(7)
                for i, row in enumerate([header] + page):
                    height = (max(1, *(len(v.splitlines()) for v in row)) + 1) / 52
                    for j in range(len(indices)):
                        table[i, j].set_height(height)
                fig.tight_layout()
                yield fig
        return
    fig, ax = plt.subplots(figsize=(10, 5.5), layout="constrained")
    ax.set_title(textwrap.fill(title, 90))
    ax.set_ylabel(data.get("unit", ""))
    if kind == "series":
        for line in data["series"]:
            points = line["points"]
            ax.plot([datetime.fromtimestamp(p[0] / 1000, timezone.utc) for p in points],
                    [float("nan") if p[1] is None else p[1] for p in points], label=line["label"])
        locator = mdates.AutoDateLocator()
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
        ax.set_xlabel("Time (UTC)")
        if data["series"]:
            ax.legend(fontsize=7, loc="upper left", bbox_to_anchor=(1, 1))
        ax.grid(alpha=.2)
    elif kind in ("bars", "bins"):
        items = data["items"] if kind == "bars" else data["bins"]
        ax.bar(range(len(items)), [v["value"] for v in items], color="#2563eb")
        ax.set_xticks(range(len(items)), [v["label"] for v in items], rotation=45, ha="right", fontsize=7)
    elif kind == "matrix":
        if data["rows"] and data["cols"]:
            image = ax.pcolormesh(data["cells"], cmap="Blues", shading="flat")
            ax.invert_yaxis()
            colorbar = fig.colorbar(image, ax=ax)
            colorbar.solids.set_rasterized(False)
            ax.set_xticks([i + .5 for i in range(len(data["cols"]))], data["cols"], rotation=45, ha="right", fontsize=7)
            ax.set_yticks([i + .5 for i in range(len(data["rows"]))], data["rows"], fontsize=7)
        ax.set_xlabel(data["colLabel"])
        ax.set_ylabel(data["rowLabel"])
    else:
        raise ValueError("Unsupported panel kind")
    yield fig


def render(payload):
    panels = payload["panels"]
    if not panels:
        raise ValueError("No panel data to export")
    output = io.BytesIO()
    if payload["format"] == "pdf":
        with PdfPages(output, metadata={"Title": panels[0]["title"], "Subject": json.dumps(payload.get("meta", {}), ensure_ascii=False)}) as pdf:
            for panel in panels:
                for fig in figures(panel):
                    try:
                        pdf.savefig(fig)
                    finally:
                        plt.close(fig)
    else:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("metadata.json", json.dumps(payload.get("meta", {}), ensure_ascii=False, indent=2))
            for index, panel in enumerate(panels, 1):
                # Numbered names avoid collisions and never accept paths from the client.
                name = f"{index:03d}"
                pdf_data = render({"format": "pdf", "panels": [panel], "meta": payload.get("meta", {})})
                archive.writestr(f"figures/{name}.pdf", pdf_data)
                archive.writestr(f"tables/{name}.csv", panel["csv"])
                archive.writestr(f"tables/{name}.tex", panel["latex"])
            archive.writestr("README.txt", "Panel titles and source are in panels.json. Each numbered PDF has matching complete CSV and LaTeX tables. LaTeX requires booktabs and longtable. Exports contain the supplied report data and selected window; no additional historical data is fetched.\n")
            archive.writestr("panels.json", json.dumps(panels, ensure_ascii=False, indent=2))
    return output.getvalue()


if __name__ == "__main__":
    sys.stdout.buffer.write(render(json.load(sys.stdin)))
