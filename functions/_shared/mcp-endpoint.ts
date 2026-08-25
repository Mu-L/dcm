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

function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Headers":
      "Accept, Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  }
}

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

function isAuthorized(request: Request, env: McpEnvironment): boolean {
  if (!env.MCP_ACCESS_TOKEN) return true

  return (
    request.headers.get("Authorization") === `Bearer ${env.MCP_ACCESS_TOKEN}`
  )
}

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

    const contentLength = request.headers.get("Content-Length")
    if (
      contentLength &&
      Number.isFinite(Number(contentLength)) &&
      Number(contentLength) > MAX_REQUEST_BYTES
    ) {
      return errorResponse(413, "Request body is too large")
    }

    const server = createServer()
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    })

    try {
      await server.connect(transport)
      const response = await transport.handleRequest(request)
      return withCors(response)
    } catch (error) {
      console.error("MCP request failed", error)
      return errorResponse(500, "MCP request failed")
    }
  }
}
