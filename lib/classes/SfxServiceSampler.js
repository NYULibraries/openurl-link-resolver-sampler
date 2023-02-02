import { AbstractServiceSampler } from './AbstractServiceSampler.js';

export class SfxServiceSampler extends AbstractServiceSampler {
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
        // Can't really use a specific selector if we want to be able to sample
        // "Multiple Object Menu" pages as well.
        return this.page.waitForLoadState( 'load' );
    }
}
