import { createMcpEndpoint } from "../../../_shared/mcp-endpoint"
import { createComposeServer } from "../../../_shared/mcp-servers"

export const onRequest = createMcpEndpoint(createComposeServer)
