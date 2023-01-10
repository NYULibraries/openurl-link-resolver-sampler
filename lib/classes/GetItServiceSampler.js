import { ServiceSampler } from './ServiceSampler.js';

export class GetItServiceSampler extends ServiceSampler {
    static #defaultEndpoint = 'https://dev.getit.library.nyu.edu/resolve';

    constructor( testCaseGroup, page, endpointOverride ) {
        super(
            'GetIt',
            'getit',
            testCaseGroup,
            page,
            endpointOverride || GetItServiceSampler.#defaultEndpoint
        );
    }

    getWaitForPromise() {
        return this.page.waitForEvent( 'response', async response => {
            if ( response.status() === 200 && response.url().startsWith( 'https://dev.getit.library.nyu.edu/resolve/partial_html_sections' ) ) {
                const responseJson = await response.json();

                return responseJson.partial_html_sections.complete === 'true';
            }
        } );
    }
}
