import { expect, it } from "vitest";
import { safeStreamResponseEvidence } from "./provider-streaming";
it.each([
 ["text/event-stream; charset=utf-8", 'data: {"private":"body"}\n\n', "text/event-stream", "SSE"],
 ["application/json", '{"private":"body"}', "application/json", "JSON"],
 ["text/event-stream", '{"private":"body"}', "text/event-stream", "JSON"],
 ["secret-header-value", "private body", "unknown", "unknown"],
])("whitelists response evidence for %s", (type, body, expectedType, framing) => {
 const r = safeStreamResponseEvidence({ status:200, headers:{"content-type":type,Authorization:"secret"},body },"renderer-fetch");
 expect(r).toMatchObject({responseContentType:expectedType,framing,dispatchCount:1,chunkCount:null,firstChunkMs:null});
 expect(JSON.stringify(r)).not.toMatch(/private|secret|Authorization/);
});
