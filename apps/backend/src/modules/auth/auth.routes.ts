import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { loginLimiter } from '../../middleware/rateLimit.js';
import { changePasswordSchema, loginSchema } from './auth.schema.js';
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
authRouter.post('/refresh', refreshController);

// Authenticated endpoints.
authRouter.post('/logout', authenticate, logoutController);
authRouter.get('/me', authenticate, meController);
authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  changePasswordController,
);
