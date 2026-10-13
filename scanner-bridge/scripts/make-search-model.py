"""Prints the base64 of the tiny ONNX graph src/recognizer/fastSearch.ts embeds:
one MatMul, library [rows x dims] times queries [dims x count] -> scores
[rows x count]. Searching the card library this way lets ONNX Runtime's
optimised, multi-threaded matrix code do the ~40 million multiply-adds per
card instead of a JavaScript loop (13 ms instead of ~350 ms on 110k cards).

Run with:  python3 scripts/make-search-model.py   (needs `pip install onnx`)
"""
import base64

import onnx
from onnx import TensorProto, helper

graph = helper.make_graph(
    [helper.make_node("MatMul", ["library", "queries"], ["scores"])],
    "library-search",
    [
        helper.make_tensor_value_info("library", TensorProto.FLOAT, ["rows", "dims"]),
        helper.make_tensor_value_info("queries", TensorProto.FLOAT, ["dims", "count"]),
    ],
    [helper.make_tensor_value_info("scores", TensorProto.FLOAT, ["rows", "count"])],
)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], producer_name="geega-scanner-bridge")
model.ir_version = 7
onnx.checker.check_model(model)
print(base64.b64encode(model.SerializeToString()).decode())
