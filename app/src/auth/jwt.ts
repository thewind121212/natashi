import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface JwtPayload {
  sub: string;        // Discord user ID (= session ID)
  username: string;
  avatar: string | null;
}

const JWT_EXPIRES_IN = '24h';

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload & { iat: number; exp: number };
    return {
      sub: decoded.sub,
      username: decoded.username,
      avatar: decoded.avatar,
    };
  } catch {
    return null;
  }
}
