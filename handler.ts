import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import axios, { AxiosResponse, AxiosRequestConfig } from 'axios';

// --- Interfaces (kept consistent) ---

interface SnykOrgData {
    id: string;
    type: string;
    attributes: {
        slug: string;
        name: string;
    };
}

interface SnykOrgResponse {
    data: SnykOrgData[];
    jsonapi: { version: string };
    links: Record<string, string>;
}

interface SnykIssueCoordinate {
    reachability: string; // "function", "package", "no-info", etc.
    is_fixable_manually: boolean;
    is_fixable_snyk: boolean;
    is_fixable_upstream: boolean;
    is_patchable: boolean;
    is_pinnable: boolean;
    is_upgradeable: boolean;
    representations: Array<{
        dependency: {
            package_name: string;
            package_version: string;
        };
    }>;
}

interface SnykIssueAttributes {
    classes: Array<{ id: string; source: string; type: string }>;
    coordinates: SnykIssueCoordinate[];
    created_at: string;
    effective_severity_level: string;
    exploit_details: {
        maturity_levels: Array<{ format: string; level: string }>;
        sources: string[];
    };
    ignored: boolean;
    key: string;
    problems: Array<{
        id: string;
        source: string;
        type: string;
        updated_at: string;
        url?: string;
    }>;
    risk: {
        factors: string[];
        score: {
            model: string;
            value: number;
        };
    };
    severities: Array<{
        level: string;
        modification_time: string;
        score: number;
        source: string;
        vector: string;
        version: string;
    }>;
    status: string;
    title: string;
    type: string; // e.g., "package_vulnerability"
    updated_at: string;
}

interface SnykIssueData {
    id: string;
    type: string;
    attributes: SnykIssueAttributes;
    relationships: {
        organization: {
            data: { id: string; type: string };
            links: { related: string };
        };
        scan_item: {
            data: { id: string; type: string };
            links: { related: string };
        };
    };
}


interface SnykIssuesResponse {
    data: SnykIssueData[];
    jsonapi: { version: string };
    links: {
        self: string;
        first?: string;
        last?: string;
        next?: string;
    };
}

// --- Helper for Snyk API Requests ---

const makeSnykApiRequest = async <T>(url: string, authToken: string): Promise<AxiosResponse<T>> => {
    const config: AxiosRequestConfig = {
        headers: {
            'Authorization': `Token ${authToken}`,
            'Content-Type': 'application/vnd.api+json',
            'Accept': 'application/vnd.api+json'
        },
        timeout: 10000,
    };
    return await axios.get<T>(url, config);
};

/**
 * Recursively fetches all pages of issues until the target issueId is found
 * or there are no more pages.
 * @param initialUrl The first URL to request (e.g., issues?limit=100&...).
 * @param authToken Snyk API token.
 * @param targetIssueKey The 'key' attribute of the issue we are looking for.
 * @returns The SnykIssueData object if found, otherwise null.
 */
const fetchAllIssuesAndFindTarget = async (
    initialUrl: string,
    authToken: string,
    targetIssueKey: string
): Promise<SnykIssueData | null> => {
    let currentUrl: string | undefined = initialUrl;

    while (currentUrl) {
        console.log('Fetching issues from:', currentUrl);
        const response: AxiosResponse<SnykIssuesResponse> = await makeSnykApiRequest<SnykIssuesResponse>(currentUrl, authToken);

        if (!response.data || !response.data.data) {
            console.log('No data or empty data array in response.');
            currentUrl = response.data.links?.next;
            if (!currentUrl) {
                console.log('No more pages to fetch after an empty data response.');
            }
            continue;
        }

        for (const issue of response.data.data) {
            if (issue.attributes.key === targetIssueKey) {
                console.log(`Found matching issue by key: ${targetIssueKey}`);
                return issue;
            }
        }

        currentUrl = response.data.links?.next;
        if (currentUrl) {
            console.log('Moving to next page:', currentUrl);
        } else {
            console.log('No more pages to fetch.');
        }
    }

    return null;
};

// --- Lambda Handler ---

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    let requestBody;
    try {
        requestBody = event.body ? JSON.parse(event.body) : {};
    } catch (error) {
        console.error('Failed to parse request body:', error);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Invalid JSON in request body.' }),
        };
    }

    const snykIssueUrl: string | undefined = requestBody.snykIssueUrl;
    const incomingSeverity: string | undefined = requestBody.severity;
    const authToken: string | undefined = process.env.authToken;

    if (!snykIssueUrl || !incomingSeverity) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Missing snykIssueUrl or severity in request body.' }),
        };
    }

    if (!authToken) {
        console.error('authToken environment variable not set.');
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Authentication token is not configured in Lambda environment variables.' }),
        };
    }

    const validSeverities = ['critical', 'high', 'medium', 'low'];
    const snykApiSeverityParam = incomingSeverity.toLowerCase();
    if (!validSeverities.includes(snykApiSeverityParam)) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: `Invalid severity level: "${incomingSeverity}". Must be one of: ${validSeverities.join(', ')}.` }),
        };
    }

    try {
        const orgSlugMatch = snykIssueUrl.match(/\/org\/([^/]+)\/project\//);
        const projectIdMatch = snykIssueUrl.match(/\/project\/([a-f0-9-]+)(?:#|$)/);
        const issueIdMatch = snykIssueUrl.match(/#issue-(.+)/);

        if (!orgSlugMatch || !projectIdMatch || !issueIdMatch) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Invalid Snyk issue URL format. Could not extract orgSlug, projectId, or issueId.' }),
            };
        }

        const orgSlug = orgSlugMatch[1];
        const projectId = projectIdMatch[1];
        const issueId = issueIdMatch[1];

        console.log(`Parsed URL: orgSlug=${orgSlug}, projectId=${projectId}, issueId=${issueId}, requested_severity=${incomingSeverity}`);

        const snykApiBase = 'https://api.snyk.io/rest';
        const snykApiVersion = '2024-10-15';

        const orgsUrl = `${snykApiBase}/orgs?version=${snykApiVersion}&slug=${orgSlug}`;
        console.log('Fetching orgId from:', orgsUrl);

        const orgsResponse: AxiosResponse<SnykOrgResponse> = await makeSnykApiRequest<SnykOrgResponse>(orgsUrl, authToken);

        if (!orgsResponse.data.data || orgsResponse.data.data.length === 0) {
            console.warn('No organization found for slug:', orgSlug);
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Organization not found for the given slug: ${orgSlug}` }),
            };
        }
        const orgId = orgsResponse.data.data[0].id;
        console.log('Found orgId:', orgId);

        const initialIssuesUrl = `${snykApiBase}/orgs/${orgId}/issues?version=${snykApiVersion}&scan_item.id=${projectId}&scan_item.type=project&effective_severity_level=${snykApiSeverityParam}&limit=100`;

        const foundIssue = await fetchAllIssuesAndFindTarget(initialIssuesUrl, authToken, issueId);

        if (!foundIssue) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Issue with key "${issueId}" not found for project ${projectId} in organization ${orgSlug} with effective severity "${incomingSeverity}".` }),
            };
        }

        let isReachable: boolean = false;
        if (foundIssue.attributes.coordinates && foundIssue.attributes.coordinates.length > 0) {
            for (const coordinate of foundIssue.attributes.coordinates) {
                if (coordinate.reachability === 'function' || coordinate.reachability === 'package') {
                    isReachable = true;
                    break;
                }
            }
        }

        // --- UPDATED RETURN BODY ---
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json', // Critical for Jira Automation!
            },
            body: JSON.stringify({
                issueId: foundIssue.id, // Renamed from foundIssueId
                isReachable: isReachable, // Renamed from isReachableByFunctionOrPackage
                fullIssueData: foundIssue // The entire found issue object
            }),
        };
        // --- END UPDATED RETURN BODY ---

    } catch (error) {
        console.error('Error during Lambda execution:', error);
        let errorMessage = 'Internal server error.';
        let statusCode = 500;

        if (axios.isAxiosError(error)) {
            console.error('Axios error details:', error.response?.status, error.response?.data);
            errorMessage = `Snyk API request failed: ${error.message}`;
            statusCode = error.response?.status || 500;
            if (error.response?.data && typeof error.response.data === 'object' && 'errors' in error.response.data) {
                const snykErrors = (error.response.data as any).errors;
                if (Array.isArray(snykErrors) && snykErrors.length > 0 && snykErrors[0].detail) {
                    errorMessage += ` Details: ${snykErrors[0].detail}`;
                }
            }
        } else if (error instanceof Error) {
            errorMessage = error.message;
        }

        return {
            statusCode: statusCode,
            body: JSON.stringify({ message: errorMessage }),
        };
    }
};