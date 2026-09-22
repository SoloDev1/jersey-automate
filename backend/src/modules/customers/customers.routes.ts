import { Router } from 'express';
import { customersController } from './customers.controller.js';

export const customersRouter = Router();

customersRouter.get('/', customersController.list);
customersRouter.get('/:id', customersController.getById);
