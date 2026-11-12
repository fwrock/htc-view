import importlib.util
import io
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("report_renderer", Path(__file__).parents[1] / "scripts/render-report.py")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class ReportRendererTest(unittest.TestCase):
    def panel(self, data):
        return {"title": "Report α & test", "data": data, "csv": "complete csv\r\n", "latex": "complete latex"}

    def test_all_chart_types_are_vector(self):
        for data in [
            {"kind": "series", "series": [{"label": "test", "points": [[1000, 2], [2000, None], [3000, 4]]}]},
            {"kind": "bars", "items": [{"label": "A", "value": 4}]},
            {"kind": "bins", "bins": [{"label": "0-1", "value": 4}]},
            {"kind": "matrix", "rows": ["a"], "cols": ["b"], "cells": [[1]], "rowLabel": "from", "colLabel": "to"},
            {"kind": "matrix", "rows": [], "cols": [], "cells": [], "rowLabel": "from", "colLabel": "to"},
            {"kind": "table", "columns": ["x", "y"], "rows": [[1, 2]], "plot": "scatter"},
            {"kind": "table", "columns": ["method", "20%", "40%"], "rows": [["a", 1, None]], "plot": "row-lines"},
            {"kind": "table", "columns": ["step", "a"], "rows": [[0, 1]], "plot": "column-lines"},
            {"kind": "table", "columns": ["method", "MAPE"], "rows": [["a", 1]], "plot": "grouped-bars"},
        ]:
            with self.subTest(kind=data):
                pdf = renderer.render({"format": "pdf", "panels": [self.panel(data)]})
                self.assertTrue(pdf.startswith(b"%PDF"))
                self.assertFalse(b"/Subtype /Image" in pdf, "chart contains a raster image")

    def test_tables_paginate_every_row_and_column(self):
        data = {"kind": "table", "columns": [f"column {i}" for i in range(14)], "rows": [[f"row {i} col {j}" for j in range(14)] for i in range(100)]}
        figures = list(renderer.figures(self.panel(data)))
        text = " ".join(cell.get_text().get_text() for fig in figures for table in fig.axes[0].tables for cell in table.get_celld().values())
        for row in data["rows"]:
            for value in row:
                self.assertIn(value, text)
        self.assertGreater(len(figures), 3)
        for fig in figures:
            renderer.plt.close(fig)

    def test_crowded_charts_keep_all_series_across_readable_pages(self):
        data = {"kind": "series", "series": [{"label": f"series {i}", "points": [[1000, i], [2000, i + 1]]} for i in range(40)]}
        figures = list(renderer.figures(self.panel(data)))
        labels = [line.get_label() for fig in figures for line in fig.axes[0].lines]
        self.assertEqual(labels, [f"series {i}" for i in range(40)])
        self.assertEqual(len(figures), 3)
        for fig in figures:
            renderer.plt.close(fig)

    def test_zip_preserves_full_tables_and_separate_pdf(self):
        panel = self.panel({"kind": "table", "columns": ["a"], "rows": [[1]]})
        archive = renderer.render({"format": "zip", "panels": [panel, panel], "meta": {"windowLabel": "all"}})
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            self.assertEqual(z.read("tables/001.csv").decode(), panel["csv"])
            self.assertEqual(z.read("tables/002.tex").decode(), panel["latex"])
            self.assertTrue(z.read("figures/002.pdf").startswith(b"%PDF"))
            self.assertIn(b"all", z.read("metadata.json"))


if __name__ == "__main__":
    unittest.main()
