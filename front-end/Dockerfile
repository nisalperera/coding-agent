# Step 1: Use a lightweight NGINX image as the base
FROM nginx:alpine

# Step 2: Copy your static web app files into the NGINX HTML directory
# This directory is where NGINX automatically looks to serve content
COPY . /usr/share/nginx/html

# Step 3: Expose port 3000 to allow web traffic
EXPOSE 3000

# Note: The base NGINX image handles starting the server automatically, 
# so you don't need to specify a CMD instruction.
