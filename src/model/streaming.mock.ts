import { MockLanguageModelV4 } from 'ai/test'

type StreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>
type Part = StreamResult['stream'] extends ReadableStream<infer P> ? P : never

/**
 * Teszt- és eval-segéd: a `doGenerate` válaszából streamet készít, így a
 * meglévő fixture-modellek a streamelő kliensen is változtatás nélkül futnak.
 * A stream a mock saját `doGenerate`-jét hívja, ezért a hívásszámlálók és a
 * `modelId` megmaradnak. Ha a `doGenerate` dob, a `doStream` is dob.
 */
export function streamingMock(opts: {
  modelId?: string
  doGenerate: MockLanguageModelV4['doGenerate']
}): MockLanguageModelV4 {
  const mock: MockLanguageModelV4 = new MockLanguageModelV4({
    ...(opts.modelId === undefined ? {} : { modelId: opts.modelId }),
    doGenerate: opts.doGenerate,
    doStream: async (options) => {
      const result = await mock.doGenerate(options)
      const parts: Part[] = [{ type: 'stream-start', warnings: result.warnings }]
      let n = 0
      for (const part of result.content) {
        const id = `p${n++}`
        if (part.type === 'text') {
          parts.push(
            { type: 'text-start', id },
            { type: 'text-delta', id, delta: part.text },
            { type: 'text-end', id },
          )
        } else if (part.type === 'tool-call') {
          parts.push(
            { type: 'tool-input-start', id: part.toolCallId, toolName: part.toolName },
            { type: 'tool-input-delta', id: part.toolCallId, delta: part.input },
            { type: 'tool-input-end', id: part.toolCallId },
            part,
          )
        }
      }
      parts.push({ type: 'finish', usage: result.usage, finishReason: result.finishReason })
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part)
            controller.close()
          },
        }),
      }
    },
  })
  return mock
}
