Order Tracking Automation Pipeline

n8n + Google Apps Script + WooCommerce Integration


📝 Overview
This project is a production-ready automation workflow designed to streamline the post-purchase customer experience. It captures order status updates from a WooCommerce store, validates the request for security, processes complex tracking logic via Google Apps Script, and delivers personalized tracking emails to customers.

By automating this process, the system reduces manual overhead for store owners and provides customers with real-time transparency regarding their order status.



🚀 Key Features
Secure Webhook Architecture: Implements HMAC SHA256 signature verification to ensure incoming data is authentic and originates from the trusted store.

Custom Data Normalization: Uses a JavaScript-based "Sanitize" node to handle varied payload structures, ensuring the pipeline remains resilient to upstream data changes.

External Logic Integration: Offloads dynamic URL generation and complex status calculations to Google Apps Script via REST API.

Multi-Channel Handling: Differentiates between successful tracking updates and error logging, ensuring all failures are recorded in a centralized Google Sheet for debugging.

Personalized Notifications: Automatically generates and sends HTML-formatted emails with dynamic tracking links via SMTP.



🛠️ Technology Stack
Automation Platform: n8n

Backend Logic: Google Apps Script

Languages: JavaScript (Node.js environment within n8n)

Security: HMAC SHA256 Signature Validation

Email: SMTP Integration



⚙️ Workflow Logic
Trigger: A Webhook receives an order.processing topic from the store.

Validation: The Crypto Node calculates an HMAC hash of the raw body and compares it to the source header for security.

Sanitization: A custom Code Node cleans strings, handles null values, and maps disparate fields into a unified JSON object.

External Processing: An HTTP Request sends the sanitized data to Google Apps Script to fetch a unique tracking URL.

Conditional Logic: * Success: The system builds and sends a localized (Hebrew) email to the customer and returns a 200 OK response.

Failure: The system logs the error (including remote IP and error reason) to a secondary logging script and returns a 401 Unauthorized or error response.



📦 Installation & Setup
n8n Setup: Import the provided order-tracking-workflow.json into your n8n instance.

Environment Variables: Configure the following credentials:

SMTP account: Your email provider details.

SECRET_APPS_SCRIPT: Your authentication token for Google Apps Script.

Apps Script: Deploy your Google Apps Script as a Web App and update the URL in the HTTP Request nodes.

Webhook Configuration: Copy the Webhook URL from n8n and paste it into your WooCommerce Webhook settings with the secret key.



📷 Workflow Visualization
<img width="1275" height="587" alt="image" src="https://github.com/user-attachments/assets/df9d5127-226d-4a82-aa57-77a510623980" />


<img width="1274" height="587" alt="image" src="https://github.com/user-attachments/assets/148123c0-1e7a-4ba9-8e2d-07b62072d330" />

