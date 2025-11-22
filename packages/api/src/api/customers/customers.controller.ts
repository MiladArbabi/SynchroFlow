// Update packages/api/src/api/customers/customers.controller.ts - Remove duplicate route
import { Request, Response } from 'express';
import * as customersService from './customers.service';

/**
 * @route   GET /api/v1/customers/:id
 * @desc    Get full customer details by ID from database
 * @access  Private
 */
export const getCustomerDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const customerData = await customersService.getCustomerDetailsById(id);

    if (customerData) {
      res.status(200).json(customerData);
    } else {
      res.status(404).json({ error: `Customer with ID ${id} not found.` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch customer: ${message}` });
  }
};