import * as path from 'node:path';

export class ServiceSampler {
    endpoint;
    name;
    page;
    serviceName;
    testCaseGroup;

    constructor( name, serviceName, testCaseGroup, page, endpoint ) {
        this.endpoint = endpoint;
        this.name = name;
        this.page = page;
        this.serviceName = serviceName;
        this.testCaseGroup = testCaseGroup;
    }

    async fetchSampleHtml( url ) {
        const waitForPromise = this.getWaitForPromise();

        await this.page.goto( url );

        await waitForPromise;

        const rawHtml = await this.page.content();

        return this.filterHtml( rawHtml );
    }

    filterHtml( html ) {
        // Do no filtering at all.
        return html;
    }

    getServiceResponseSampleFilePathRelative( key ) {
        return path.join( this.testCaseGroup, this.serviceName, key.charAt( 0 ), `${key}.html` );
    }

    getWaitForPromise() {
        console.error( '`getWaitForPromise` is not implemented' );
    }
}
