// apps/backend/src/api/customers/customers.controller.ts
 import { Request, Response } from 'express';
import { CustomersService } from './customers.service';
 
 /**
  * @route   GET /api/v1/customers/:id
  * @desc    Get full customer details by ID
  * @access  Private
  */
 export const getCustomerDetails = async (req: Request, res: Response) => {
   try {
     const { id } = req.params;
    // TODO: Get shopId from authenticated user session
    const shopId = 1; // Temporary hardcoded for development
    
    const customerData = await CustomersService.getCustomerDetailsById(id, shopId);
 
     if (customerData) {
       res.status(200).json(customerData);
     } else {
       res.status(404).json({ error: `Customer with ID ${id} not found.` });
     }
   } catch (error) {
     const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in getCustomerDetails:', error);
     res.status(500).json({ error: `Failed to fetch customer: ${message}` });
   }
 };

/**
 * @route   GET /api/v1/customers
 * @desc    Get list of customers for a shop
 * @access  Private
 */
export const getCustomerList = async (req: Request, res: Response) => {
  try {
    // TODO: Get shopId from authenticated user session
    const shopId = 1; // Temporary hardcoded for development
    
    const customers = await CustomersService.getCustomerList(shopId);
    
    res.status(200).json(customers);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in getCustomerList:', error);
    res.status(500).json({ error: `Failed to fetch customers: ${message}` });
  }
};