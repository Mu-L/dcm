import {
  type McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server"

export interface McpEnvironment {
  MCP_ACCESS_TOKEN?: string
}

export interface McpRequestContext {
  request: Request
  env: McpEnvironment
}

export type McpPagesFunction = (
  context: McpRequestContext,
) => Response | Promise<Response>

const MAX_REQUEST_BYTES = 128 * 1024

/** Return the CORS policy shared by every MCP response. */
function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Headers":
      "Accept, Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  }
}

/** Read at most the configured request limit before handing the body to MCP. */
async function limitRequestBody(request: Request): Promise<Request | null> {
  const contentLength = request.headers.get("Content-Length")
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_REQUEST_BYTES
  ) {
    return null
  }

  if (!request.body) return request

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    totalBytes += value.byteLength
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel()
      return null
    }

    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new Request(request, { body })
}

/** Add the shared CORS policy without consuming the response body stream. */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers)

  for (const [name, value] of Object.entries(getCorsHeaders())) {
    headers.set(name, value)
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

/** Return a JSON error response with the shared CORS policy applied. */
function errorResponse(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return withCors(
    Response.json(
      {
        error: message,
      },
      {
        headers,
        status,
      },
    ),
  )
}

/** Check the optional Pages secret before dispatching an MCP request. */
function isAuthorized(request: Request, env: McpEnvironment): boolean {
  if (!env.MCP_ACCESS_TOKEN) return true

  return (
    request.headers.get("Authorization") === `Bearer ${env.MCP_ACCESS_TOKEN}`
  )
}

/** Create a stateless MCP Pages Function around one server factory. */
export function createMcpEndpoint(
  createServer: () => McpServer,
): McpPagesFunction {
  return async ({ request, env }) => {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }))
    }

    if (!isAuthorized(request, env)) {
      return errorResponse(401, "Unauthorized", {
        "WWW-Authenticate": "Bearer",
      })
    }

    if (request.method !== "POST") {
      return errorResponse(405, "Only POST requests are supported", {
        Allow: "POST, OPTIONS",
      })
    }

    try {
      const boundedRequest = await limitRequestBody(request)
      if (!boundedRequest) {
        return errorResponse(413, "Request body is too large")
      }

      const server = createServer()
      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
      })

      await server.connect(transport)
      const response = await transport.handleRequest(boundedRequest)
      return withCors(response)
    } catch (error) {
      console.error("MCP request failed", error)
      return errorResponse(500, "MCP request failed")
    }
  }
}
