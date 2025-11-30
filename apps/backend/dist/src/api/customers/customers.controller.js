"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomerList = exports.getCustomerDetails = void 0;
const customers_service_1 = require("./customers.service");
/**
 * @route   GET /api/v1/customers/:id
 * @desc    Get full customer details by ID
 * @access  Private
 */
const getCustomerDetails = async (req, res) => {
    try {
        const { id } = req.params;
        // TODO: Get shopId from authenticated user session
        const shopId = 1; // Temporary hardcoded for development
        const customerData = await customers_service_1.CustomersService.getCustomerDetailsById(id, shopId);
        if (customerData) {
            res.status(200).json(customerData);
        }
        else {
            res.status(404).json({ error: `Customer with ID ${id} not found.` });
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in getCustomerDetails:', error);
        res.status(500).json({ error: `Failed to fetch customer: ${message}` });
    }
};
exports.getCustomerDetails = getCustomerDetails;
/**
 * @route   GET /api/v1/customers
 * @desc    Get list of customers for a shop
 * @access  Private
 */
const getCustomerList = async (req, res) => {
    try {
        // TODO: Get shopId from authenticated user session
        const shopId = 1; // Temporary hardcoded for development
        const customers = await customers_service_1.CustomersService.getCustomerList(shopId);
        res.status(200).json(customers);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in getCustomerList:', error);
        res.status(500).json({ error: `Failed to fetch customers: ${message}` });
    }
};
exports.getCustomerList = getCustomerList;
