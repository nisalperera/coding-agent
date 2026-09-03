# Use the official slim Python image
FROM python:3.12-slim

# Set the working directory inside the container
WORKDIR /code

# Copy the requirements file first to leverage Docker cache
COPY ./requirements.txt /code/requirements.txt

# Install dependencies
RUN pip install --no-cache-dir -r /code/requirements.txt

# Copy the application code
COPY ./app /code/app
COPY ./main.py /code/main.py

EXPOSE 8000

# Run the FastAPI application using the official 'fastapi run' command
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]