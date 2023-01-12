import { AbstractServiceSampler } from './AbstractServiceSampler.js';

export class AriadneServiceSampler extends AbstractServiceSampler {
    static #defaultEndpoint = 'http://localhost:3000/';

    constructor( testCaseGroup, page, endpointOverride ) {
        super(
            'Ariadne',
            'ariadne',
            testCaseGroup,
            page,
            endpointOverride || AriadneServiceSampler.#defaultEndpoint
        );
    }

    getWaitForPromise() {
        return this.page.locator( 'div.loader' ).waitFor( { state: 'hidden' } );
    }

    // In case we (perhaps accidentally) run this against a development instance,
    // which inserts extremely large sourceMappingURL comments that can increase
    // the size of the HTML by almost a megabyte.
    filterHtml( html ) {
        const regex = new RegExp( '/\\*#\\ssourceMappingURL=\\s*\\S+\\s\\*\\/', 'g' );

        return html.replace( regex, '' );
    }
}
