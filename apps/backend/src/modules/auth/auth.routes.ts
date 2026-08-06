import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate, authenticateOptional } from '../../middleware/auth.js';
import { loginLimiter } from '../../middleware/rateLimit.js';
import { changePasswordSchema, loginSchema, refreshSchema } from './auth.schema.js';
import {
  changePasswordController,
  loginController,
  logoutController,
  meController,
  refreshController,
} from './auth.controller.js';

export const authRouter = Router();

// Public (rate-limited) endpoints.
authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), loginController);
authRouter.post('/refresh', validate({ body: refreshSchema }), refreshController);

// Logout is authorized by possession of the refresh cookie, not by the access token — it has
// to keep working after the 15-minute access token has expired, or "log out" would leave the
// refresh family alive server-side for its full 7-day lifetime.
authRouter.post('/logout', authenticateOptional, validate({ body: refreshSchema }), logoutController);

// Authenticated endpoints.
authRouter.get('/me', authenticate, meController);
authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  changePasswordController,
);
