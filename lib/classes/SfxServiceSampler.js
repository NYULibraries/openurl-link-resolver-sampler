import { ServiceSampler } from './ServiceSampler.js';

export class SfxServiceSampler extends ServiceSampler {
    static #defaultEndpoint = 'http://sfx.library.nyu.edu/sfxlcl41';

    constructor( testCaseGroup, page, endpointOverride ) {
        super(
            'SFX',
            'sfx',
            testCaseGroup,
            page,
            endpointOverride || SfxServiceSampler.#defaultEndpoint
        );
    }

    getWaitForPromise() {
        return this.page.waitForSelector( 'div.footer' );
    }
}
