"""Builds src/recognizer/__fixtures__/tiny-fingerprint.onnx — a few-KB stand-in
for the DINOv2 fingerprint model, with the same inputs and outputs
(pixel_values -> last_hidden_state, pooler_output), so the embedder's ONNX
Runtime plumbing can be tested without downloading the real 88 MB model.

Run with:  python3 scripts/make-test-model.py   (needs `pip install onnx`)
"""
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

D = 16
rng = np.random.default_rng(7)
w = numpy_helper.from_array(rng.normal(size=(3, D)).astype(np.float32), name="w")
b = numpy_helper.from_array(rng.normal(scale=0.1, size=(D,)).astype(np.float32), name="b")
shape = numpy_helper.from_array(np.array([0, 3, -1], dtype=np.int64), name="shape")
axes1 = numpy_helper.from_array(np.array([1], dtype=np.int64), name="axes1")

nodes = [
    helper.make_node("AveragePool", ["pixel_values"], ["pooled"], kernel_shape=[14, 14], strides=[14, 14]),
    helper.make_node("Reshape", ["pooled", "shape"], ["flat"]),
    helper.make_node("Transpose", ["flat"], ["patches_raw"], perm=[0, 2, 1]),
    helper.make_node("MatMul", ["patches_raw", "w"], ["proj"]),
    helper.make_node("Add", ["proj", "b"], ["biased"]),
    helper.make_node("Tanh", ["biased"], ["patches"]),
    helper.make_node("ReduceMean", ["patches"], ["cls"], axes=[1], keepdims=1),
    helper.make_node("Concat", ["cls", "patches"], ["last_hidden_state"], axis=1),
    helper.make_node("Squeeze", ["cls", "axes1"], ["pooler_output"]),
]
graph = helper.make_graph(
    nodes,
    "tiny-fingerprint",
    [helper.make_tensor_value_info("pixel_values", TensorProto.FLOAT, ["batch", 3, 224, 224])],
    [
        helper.make_tensor_value_info("last_hidden_state", TensorProto.FLOAT, ["batch", 257, D]),
        helper.make_tensor_value_info("pooler_output", TensorProto.FLOAT, ["batch", D]),
    ],
    initializer=[w, b, shape, axes1],
)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], producer_name="geega-test")
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, "src/recognizer/__fixtures__/tiny-fingerprint.onnx")
print("wrote tiny-fingerprint.onnx")

# The same model exported with a fixed batch of one image, like some exports
# are: the embedder must notice and fall back to one image per run.
graph.input[0].type.tensor_type.shape.dim[0].ClearField("dim_param")
graph.input[0].type.tensor_type.shape.dim[0].dim_value = 1
for out in graph.output:
    out.type.tensor_type.shape.dim[0].ClearField("dim_param")
    out.type.tensor_type.shape.dim[0].dim_value = 1
fixed = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], producer_name="geega-test")
fixed.ir_version = 8
onnx.checker.check_model(fixed)
onnx.save(fixed, "src/recognizer/__fixtures__/tiny-fingerprint-batch1.onnx")
print("wrote tiny-fingerprint-batch1.onnx")
