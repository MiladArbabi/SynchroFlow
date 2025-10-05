from fastapi import FastAPI

app = FastAPI(
    title="SynchroFlow AI Engine",
    description="A microservice for demand forecasting and financial analysis.",
    version="1.0.0"
)

@app.get("/")
def read_root():
    """A simple health check endpoint."""
    return {"status": "ok", "service": "AI Engine"}

# Placeholder for our future forecasting endpoint
@app.post("/predict/demand")
async def predict_demand(data: dict):
    # In the future, this will take historical sales data
    # and return a forecast.
    return {"sku": data.get("sku"), "forecast": "Not yet implemented"}