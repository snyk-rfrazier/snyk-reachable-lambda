# Snyk Reachability Checker Lambda

This AWS Lambda function acts as an intermediary for Jira Cloud Automation, enabling robust fetching and analysis of Snyk vulnerability data, specifically focusing on the "reachability" attribute. Due to limitations in Jira Automation's direct parsing of `application/vnd.api+json` responses from Snyk's API, this Lambda provides a reliable endpoint to get the necessary issue details.

---

## Features

* **Snyk URL Parsing:** Automatically extracts `orgSlug`, `projectId`, and `issueId` from a provided Snyk issue URL.
* **Dynamic Severity Filtering:** Allows specifying the desired `effective_severity_level` (e.g., `critical`, `high`) for Snyk API requests.
* **Pagination Handling:** Fetches all necessary pages from the Snyk Issues API to ensure the target issue is found, even if it's deep within the results.
* **Reachability Check:** Determines if the identified Snyk issue has an associated "coordinate" with a `reachability` of `function` or `package`.
* **Structured Output:** Returns a clear JSON response with the Snyk issue ID, the reachability status, and the full raw issue data for flexible consumption by Jira Automation.
* **Secure Authentication:** Utilizes AWS Lambda environment variables for the Snyk API token, promoting secure credential management.

---

## Technologies Used

* **TypeScript** 
* **Node.js** 
* **Axios** 
* **AWS Lambda** 
* **AWS API Gateway** 
* **Snyk API** 
* **Jira Cloud Automation** 

---

## Prerequisites

Before deploying and using this Lambda, ensure you have:

* An **AWS Account** with sufficient permissions to create Lambda functions, IAM roles, and API Gateway endpoints.
* **Node.js** (LTS recommended) and **npm** installed locally for development and packaging.
* A **Snyk API Token** with read permissions for organizations and projects.

---

## Local Development Setup

To get started with local development and testing:

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/snyk-rfrazier/snyk-reachable-lambda.git](https://github.com/snyk-rfrazier/snyk-reachable-lambda.git)
    cd snyk-reachable-lambda
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Compile the TypeScript code:**
    ```bash
    npx tsc
    ```
    This command compiles `src/handler.ts` into `dist/handler.js` (and any other `.ts` files in `src` to `dist`).

4.  **Local Testing (Optional):**
    You can create a simple local script to test the `handler.js` if you wish, mimicking the Lambda invocation. However, end-to-end testing with actual API calls will require deployment.

---

## Deployment to AWS Lambda

Follow these steps to deploy your Lambda function:

1.  **Create IAM Role for Lambda:**
    * In the AWS IAM console, create a new **IAM Role**.
    * Choose **AWS service** and then **Lambda**.
    * Attach the `AWSLambdaBasicExecutionRole` policy (provides CloudWatch Logs permissions).
    * Name the role something descriptive, e.g., `SnykReachableLambdaRole`.

2.  **Create the Lambda Function:**
    * Go to the AWS Lambda console.
    * Click **"Create function"**.
    * Select **"Author from scratch"**.
    * **Function name:** `SnykReachableChecker` (or your preferred name).
    * **Runtime:** Choose the latest Node.js LTS version (e.g., Node.js 20.x).
    * **Architecture:** `x86_64` (default).
    * **Execution role:** Select "Use an existing role" and choose the IAM role you created (`SnykReachableLambdaRole`).
    * Click **"Create function"**.

3.  **Configure Lambda Settings:**
    * Navigate to the **"Configuration"** tab of your new Lambda function.
    * Under **"General configuration"**, you might want to increase the **"Memory"** (e.g., 256MB) and **"Timeout"** (e.g., 30 seconds) to accommodate API call latency and potential pagination loops.

4.  **Add Snyk API Token as Environment Variable:**
    * In the Lambda's **"Configuration"** tab, go to **"Environment variables"**.
    * Click **"Edit"**.
    * Click **"Add environment variable"**.
    * Set **Key:** `authToken`
    * Set **Value:** Your actual Snyk API Token.
    * Click **"Save"**.

5.  **Package and Upload Code:**
    * In your local project directory, ensure your TypeScript is compiled (`npx tsc`).
    * Navigate into your `dist` directory:
        ```bash
        cd dist
        ```
    * Create the deployment `.zip` package, ensuring `handler.js` and `node_modules` are at the root level of the zip:
        ```bash
        zip -r ../lambda_deployment.zip . ../node_modules
        ```
    * Go back to the Lambda console, in the **"Code"** tab.
    * Click **"Upload from"** -> **".zip file"**.
    * Upload the `lambda_deployment.zip` file (it's in your project root, e.g., `snyk-reachable-lambda/lambda_deployment.zip`).
    * Ensure the **"Handler"** field under "Runtime settings" is correctly set to `handler.handler` (file name `handler.js` and exported function `handler`).

6.  **Configure API Gateway Trigger:**
    * In the Lambda's **"Configuration"** tab, go to **"Triggers"**.
    * Click **"Add trigger"**.
    * Select **"API Gateway"** from the dropdown.
    * **API type:** Choose **"REST API"**.
    * **Security:** For testing, you can select "Open," but for production, consider an IAM role or Lambda authorizer for enhanced security.
    * Click **"Add"**.
    * After creation, make note of the **API endpoint URL**. This is what Jira Automation will call.

---

## Jira Automation Integration

This Lambda function is designed to be called by a Jira Cloud Automation rule.

### **Jira Automation Rule Details:**

This example will assume we're checking for any critical vulnerability that are also reachable. The provided Jira Automation rule `Create Issue for Criticals - Reachable Only` is configured as follows:

* **Trigger:** `Vulnerability created` with `Severities = critical`.
* **Actions:**
    * Logs the vulnerability URL.
    * Sends a web request to the Lambda function.
    * Logs the Lambda's response.
* **Conditions (after web request):**
    * **IF** the web response status is `200`
    * **AND IF** `webResponse.body.isReachable` is `true`
    * **THEN:** It logs a message and creates a Jira issue.
    * **ELSE:** It logs a skipping message.

### **Web Request Configuration:**

The "Send web request" action in your Jira rule is set up with:

* **Web request URL:** API endpoint URL created by API Gateway in the previous step.
* **Headers:**
    * `Content-Type`: `application/json`
* **Web request body (Custom data):**
    ```json
    {
      "snykIssueUrl": "{{vulnerability.url}}",
      "severity": "{{vulnerability.severity}}"
    }
    ```
    * `snykIssueUrl`: Populated from the Jira `vulnerability.url` smart value.
    * `severity`: Populated from the Jira `vulnerability.severity` smart value.
* **Method:** `POST`
* **Delay execution of subsequent rule actions until we've received a response for this web request**: `true`

### **Accessing Lambda Output in Jira Automation:**

After the "Send web request" action, the `webResponse` smart value will contain the parsed JSON output from your Lambda. You can access its properties using dot notation:

* **`{{webResponse.body.issueId}}`**: The Snyk internal ID of the matched issue.
* **`{{webResponse.body.isReachable}}`**: A boolean (`true` or `false`) indicating if the issue has `function` or `package` reachability.
* **`{{webResponse.body.fullIssueData}}`**: The entire Snyk issue object. You can then drill down into this for any attribute:
    * `{{webResponse.body.fullIssueData.attributes.title}}`
    * `{{webResponse.body.fullIssueData.attributes.status}}`
    * `{{webResponse.body.fullIssueData.attributes.effective_severity_level}}`
    * `{{webResponse.body.fullIssueData.attributes.problems.0.url}}` (to get the URL of the first problem/CVE)

---

## Error Handling

The Lambda is designed with fairly simplistic error handling for various scenarios (*for any production application, please make sure to improve this*):

* **Invalid Request Body:** Returns `400 Bad Request` if `snykIssueUrl` or `severity` are missing or invalid JSON.
* **Missing Auth Token:** Returns `500 Internal Server Error` if `authToken` environment variable is not set in Lambda.
* **Invalid URL Format:** Returns `400 Bad Request` if `orgSlug`, `projectId`, or `issueId` cannot be extracted from the Snyk URL.
* **Snyk API Errors:** Catches Axios errors, logs the full Snyk API error response, and returns an appropriate status code and message.
* **Issue Not Found:** Returns `404 Not Found` if the specified Snyk issue (by key, project, and severity) is not found after checking all available pages.

---