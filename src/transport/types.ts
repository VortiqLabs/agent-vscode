import {
    AgentRequest,
    AgentResponse
} from "../agent/types";

export interface TransportRequest {
    request: AgentRequest;
}

export interface TransportResponse {
    response: AgentResponse;
}

export interface HealthResponse {
    ok: true;
    service: "vortiqlabs-agent";
    version: string;
}