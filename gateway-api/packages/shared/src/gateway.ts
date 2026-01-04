import { SignJWT, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose';
import { z } from 'zod';

export enum ProjectRoute {
  AUTH = 'AUTH',
  KV = 'KV',
  BUILD = 'BUILD',
  CORE = 'CORE',
  BASE = 'BASE',
  WEBHOOK = 'WEBHOOK',
}

/**
 * Unified error shape returned across API, KV, build, and core workers
 */
export const GatewayErrorSchema = z.object({
  route: z.nativeEnum(ProjectRoute),
  status: z.number().int().min(400).max(599),
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(8).optional(),
  timestamp: z.string().datetime(),
  details: z.record(z.any()).optional(),
});

export type GatewayError = z.infer<typeof GatewayErrorSchema>;

/**
 * JWT payload describing the project and channel the gateway token belongs to.
 */
export const GatewayTokenClaimsSchema = z.object({
  projectId: z.string().min(4),
  route: z.nativeEnum(ProjectRoute),
  scopes: z.array(z.string().min(1)).default([]),
  environment: z.enum(['staging', 'production']).default('production'),
  issuedBy: z.string().default('gateway.metacogna.ai'),
});

export type GatewayTokenClaims = z.infer<typeof GatewayTokenClaimsSchema>;

interface CreateGatewayTokenOptions {
  issuer?: string;
  subject?: string;
  audience?: string | string[];
  expiresIn?: string | number;
  algorithm?: 'HS256' | 'HS384' | 'HS512';
}

interface VerifyGatewayTokenOptions extends Omit<JWTVerifyOptions, 'audience' | 'issuer'> {
  issuer?: string | string[];
  audience?: string | string[];
}

const DEFAULT_ISSUER = 'gateway.metacogna.ai';
const DEFAULT_AUDIENCE = 'metacogna-clients';
const encoder = new TextEncoder();

const secretToKey = (secret: string) => encoder.encode(secret);

/**
 * Create a signed JWT that downstream workers can verify to authorize requests.
 */
export const createGatewayToken = async (
  claims: GatewayTokenClaims,
  secret: string,
  options: CreateGatewayTokenOptions = {}
) => {
  const payload = GatewayTokenClaimsSchema.parse(claims);
  const jwt = new SignJWT({
    projectId: payload.projectId,
    route: payload.route,
    scopes: payload.scopes,
    environment: payload.environment,
    issuedBy: payload.issuedBy,
  })
    .setProtectedHeader({ alg: options.algorithm ?? 'HS256', typ: 'JWT' })
    .setIssuer(options.issuer ?? DEFAULT_ISSUER)
    .setAudience(options.audience ?? DEFAULT_AUDIENCE)
    .setSubject(options.subject ?? payload.projectId)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '1h');

  return jwt.sign(secretToKey(secret));
};

export interface VerifyGatewayTokenResult {
  payload: JWTPayload;
  claims: GatewayTokenClaims;
}

/**
 * Verify and decode a gateway token. Throws when signature or claims are invalid.
 */
export const verifyGatewayToken = async (
  token: string,
  secret: string,
  options: VerifyGatewayTokenOptions = {}
): Promise<VerifyGatewayTokenResult> => {
  const { payload } = await jwtVerify(token, secretToKey(secret), {
    issuer: options.issuer ?? DEFAULT_ISSUER,
    audience: options.audience ?? DEFAULT_AUDIENCE,
    ...options,
  });

  return {
    payload,
    claims: GatewayTokenClaimsSchema.parse({
      projectId: payload.projectId,
      route: payload.route,
      scopes: payload.scopes ?? [],
      environment: payload.environment ?? 'production',
      issuedBy: payload.issuedBy ?? DEFAULT_ISSUER,
    }),
  };
};
