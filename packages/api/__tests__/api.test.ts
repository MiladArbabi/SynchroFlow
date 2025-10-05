// __tests__/api.test.ts
import request from 'supertest';
// We will need to export our app from server.ts for testing
import app from '../src/server'; 

describe('GET /', () => {
  it('should respond with a welcome message', async () => {
    const response = await request(app).get('/');
    expect(response.statusCode).toBe(200);
    expect(response.text).toBe('SynchroFlow API is running!');
  });
});