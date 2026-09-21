import { Router } from 'express';
import { catalogController } from './catalog.controller.js';
import { validateRequest } from '../../core/middleware/validateRequest.js';
import {
  createJerseySchema,
  updateJerseySchema,
  adjustStockSchema,
  catalogFilterSchema
} from './catalog.schema.js';

export const catalogRouter = Router();

// 1. List jerseys with search, filters & size-level stock
catalogRouter.get(
  '/',
  validateRequest({ query: catalogFilterSchema }),
  catalogController.list
);

// 2. Get single jersey details by ID
catalogRouter.get('/:id', catalogController.getById);

// 3. Create a new jersey with initial size stock
catalogRouter.post(
  '/',
  validateRequest({ body: createJerseySchema }),
  catalogController.create
);

// 4. Update jersey price, status, or description
catalogRouter.patch(
  '/:id',
  validateRequest({ body: updateJerseySchema }),
  catalogController.update
);

// 5. Adjust physical stock quantity on hand for a size
catalogRouter.post(
  '/:id/stock',
  validateRequest({ body: adjustStockSchema }),
  catalogController.adjustStock
);

// 6. Deactivate a jersey
catalogRouter.delete('/:id', catalogController.delete);
