import { createMcpEndpoint } from "../../../_shared/mcp-endpoint"
import { createToolsServer } from "../../../_shared/mcp-servers"

export const onRequest = createMcpEndpoint(createToolsServer)
