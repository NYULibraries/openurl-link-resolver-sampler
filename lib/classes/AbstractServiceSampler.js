import * as path from 'node:path';

export class AbstractServiceSampler {
    endpoint;
    name;
    page;
    serviceName;
    testCaseGroup;

    constructor( name, serviceName, testCaseGroup, page, endpoint ) {
        if ( this.constructor === AbstractServiceSampler ) {
            throw new Error( "Cannot instantiate abstract class" );
        }

        this.endpoint = endpoint;
        this.name = name;
        this.page = page;
        this.serviceName = serviceName;
        this.testCaseGroup = testCaseGroup;
    }

    async fetchSampleHtml( url ) {
        await this.page.goto( url );

        await this.getWaitForPromise();

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
        // In theory can never get here because instantiation of the class is not
        // allowed, but just in case, print an error message.  Throwing an error
        // won't really do anything because the calling of this method in `fetchSampleHtml`
        // is not wrapped in a try/catch.
        console.error( 'This method has not been implemented' );
    }
}
