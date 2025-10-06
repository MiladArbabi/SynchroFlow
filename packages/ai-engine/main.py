from fastapi import FastAPI
from pydantic import BaseModel
import pandas as pd
from statsmodels.tsa.arima.model import ARIMA

# --- Pydantic Models for Data Validation ---
# This defines the data structure we expect in the API request.
class DemandRequest(BaseModel):
    sku: str
    historical_sales: list[int] # A list of sales numbers, e.g., [10, 12, 15, 14]

# This defines the data structure of our API response.
class ForecastResponse(BaseModel):
    sku: str
    forecast: list[float]

# --- Core Forecasting Logic ---
def generate_forecast(sales_data: list[int], forecast_periods: int) -> list[float]:
    """
    Generates a sales forecast using a simple ARIMA model.
    """
    # Create a pandas Series, which is the required format for statsmodels
    series = pd.Series(sales_data)
    
    # Define the ARIMA model. The (1, 1, 1) order is a common starting point.
    # We use 'enforce_stationarity' and 'enforce_invertibility' to avoid warnings with simple data.
    model = ARIMA(series, order=(1, 1, 1), enforce_stationarity=False, enforce_invertibility=False)
    
    # Fit the model to the data
    model_fit = model.fit()
    
    # Generate the forecast for the next 'forecast_periods'
    forecast = model_fit.forecast(steps=forecast_periods)
    
    # Return the forecast as a standard Python list
    return forecast.tolist()

# --- FastAPI Application ---
app = FastAPI(
    title="SynchroFlow AI Engine",
    description="A microservice for demand forecasting and financial analysis.",
    version="1.0.0"
)

@app.get("/")
def read_root():
    """A simple health check endpoint."""
    return {"status": "ok", "service": "AI Engine"}

# Updated endpoint to use our forecasting logic
@app.post("/predict/demand", response_model=ForecastResponse)
async def predict_demand(request: DemandRequest):
    """
    Accepts historical sales data for a SKU and returns a future demand forecast.
    """
    # Generate a forecast for the next 3 periods (e.g., months or weeks)
    forecast_values = generate_forecast(request.historical_sales, forecast_periods=3)
    
    # Return the result in the format defined by our ForecastResponse model
    return {"sku": request.sku, "forecast": forecast_values}