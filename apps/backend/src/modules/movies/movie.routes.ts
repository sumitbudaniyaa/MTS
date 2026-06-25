import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Roles } from '../../types/index.js';
import {
  createMovieSchema,
  idParamSchema,
  movieListQuerySchema,
  updateMovieSchema,
} from './movie.schema.js';
import * as ctrl from './movie.controller.js';

export const movieRouter = Router();

// USER-facing: only visible/bookable movies, internal fields stripped.
movieRouter.get('/available', ctrl.listAvailableMovies);

movieRouter.use(authenticate);

// SCANNER-facing: movies relevant for door verification.
movieRouter.get('/scanner', authorize(Roles.SCANNER, Roles.ADMIN), ctrl.listScannerMovies);

// ADMIN management.
movieRouter.post('/', authorize(Roles.ADMIN), validate({ body: createMovieSchema }), ctrl.createMovie);
movieRouter.get('/', authorize(Roles.ADMIN), validate({ query: movieListQuerySchema }), ctrl.listMovies);
movieRouter.get('/:id', authorize(Roles.ADMIN), validate({ params: idParamSchema }), ctrl.getMovie);
movieRouter.patch(
  '/:id',
  authorize(Roles.ADMIN),
  validate({ params: idParamSchema, body: updateMovieSchema }),
  ctrl.updateMovie,
);
movieRouter.delete('/:id', authorize(Roles.ADMIN), validate({ params: idParamSchema }), ctrl.deleteMovie);
