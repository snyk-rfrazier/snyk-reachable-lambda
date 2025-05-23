# Snyk Reachability Checker Lambda

This AWS Lambda function acts as an intermediary for Jira Cloud Automation, enabling robust fetching and analysis of Snyk vulnerability data, specifically focusing on the "reachability" attribute. Due to limitations in Jira Automation's direct parsing of `application/vnd.api+json` responses from Snyk's API, this Lambda provides a reliable endpoint to get the necessary issue details.

---

## Disclaimer
This is not an officially supported Snyk tool and is not directly endorsed by Snyk

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

This Lambda function is specifically designed to enhance your Jira Cloud Automation workflows. Below is a detailed guide on how to set up the Jira automation rule. 

### **Jira Automation Rule: "Create Issue for Criticals - Reachable Only"**

This rule will trigger when a Snyk vulnerability event is created, and then use the Lambda to determine if a Jira issue should be created based on the vulnerability's reachability. This example will assume we're checking for any critical vulnerability that are also reachable. The provided Jira Automation rule `Create Issue for Criticals - Reachable Only` is configured as follows:

#### **1. Rule Overview:**

* **Rule Name:** `Create Issue for Criticals - Reachable Only`
* **Description:** (Optional) Creates Jira issues for critical Snyk vulnerabilities that are determined to be "reachable" via the external Lambda function.

#### **2. Setting up the Trigger:**

This rule is initiated by a Snyk vulnerability event.

* In your Jira Automation rule editor, add a **"Trigger"** component.
    * **Trigger Type:** `Vulnerability created (Security, Vulnerability Event)`
    * **Configuration:**
        * **Severities:** `critical`. 

#### **3. Setting up the Actions (Initial Logging & Web Request):**

After the trigger, the rule performs some logging and then invokes your Lambda.

* Add an **"Action"** component.
    * **Action Type:** `Log action`
    * **Message:** `Vulnerability URL is {{vulnerability.url}}`

* Add another **"Action"** component.
    * **Action Type:** `Send web request`
    * **Web request URL:** `API endpoint URL` created by API Gateway in the previous step.
    * **Headers:**
        * Add a header: `Content-Type` with value `application/json`.
    * **Web request body:** Select `Custom data` and paste the following JSON:
        ```json
        {
        "snykIssueUrl": "{{vulnerability.url}}",
        "severity": "{{vulnerability.severity}}"
        }
        ```
        * `snykIssueUrl`: This smart value `{{vulnerability.url}}` automatically pulls the Snyk vulnerability's external URL from the incoming Snyk event.
        * `severity`: This smart value `{{vulnerability.severity}}` extracts the severity level (e.g., "critical", "high") from the Snyk event.
    * **Method:** `POST`
    * **Delay execution of subsequent rule actions until we've received a response for this web request**: `true`

* Add another **"Action"** component.
    * **Action Type:** `Log action`
    * **Message:** `Response: {{webResponse}}`

#### **4. Implementing Conditional Logic (If/Else Block):**

This is where the Lambda's response is used to decide whether to create a Jira issue.

* Add a **"IF: Add a condition"** component.
* **Condition Type:** `IF or ELSE: Add condition options` 
* **Choose "IF" block conditions:** Select `All conditions match (AND)`.
    * **Add a condition:**
        * **Condition Type:** `Compare two values`
        * **First value:** `{{webResponse.status}}`
        * **Condition:** `Equals`
        * **Second value:** `200`
    * **Add another condition:**
        * **Condition Type:** `Compare two values`
        * **First value:** `{{webResponse.body.isReachable}}` 
        * **Condition:** `Equals`
        * **Second value:** `true`

#### **5. Actions for "IF" (Vulnerability is Reachable):**

If both conditions in the "IF" block are met (Lambda status is 200 AND `isReachable` is true), a Jira issue is created.

* Within the **"THEN"** branch of your "If/else block":
    * Add an **"Action"** component.
        * **Action Type:** `Log action`
        * **Message:** `Creating ticket, as vulnerability is reachable`.
    * Add another **"Action"** component.
        * **Action Type:** `Create issue`
        * **Fields to set:**
            * **Summary:** `Fix {{vulnerability.displayName}}`
            * **Description:** 
                * ` URL: {{vulnerability.url}}`
                * `Description: {{vulnerability.description.wiki}}`
        

#### **6. Actions for "ELSE" (Vulnerability is Not Reachable or Lambda Failed):**

If the conditions in the "IF" block are not met (e.g., Lambda returns non-200, or `isReachable` is false), the issue creation is skipped.

* Within the **"ELSE"** branch of your "If/else block":
    * Add an **"Action"** component.
    * **Action Type:** `Log action`
    * **Message:** `Skipping ticket as vulnerability is not reachable.` 

---

## Error Handling

The Lambda is designed with fairly simplistic error handling for various scenarios (*for any production application, please make sure to improve this*):

* **Invalid Request Body:** Returns `400 Bad Request` if `snykIssueUrl` or `severity` are missing or invalid JSON.
* **Missing Auth Token:** Returns `500 Internal Server Error` if `authToken` environment variable is not set in Lambda.
* **Invalid URL Format:** Returns `400 Bad Request` if `orgSlug`, `projectId`, or `issueId` cannot be extracted from the Snyk URL.
* **Snyk API Errors:** Catches Axios errors, logs the full Snyk API error response, and returns an appropriate status code and message.
* **Issue Not Found:** Returns `404 Not Found` if the specified Snyk issue (by key, project, and severity) is not found after checking all available pages.

---

## Notes

The Lambda sends back the full raw issue JSON from the Snyk Issues API. This example is just a simple use case for determining reachability, but a lot more data can be accessed from the `{{webResponse.body.fullIssueData}}` Smart Value in Jira Automation.