import { AbstractServiceSampler } from './AbstractServiceSampler.js';

export class GetItServiceSampler extends AbstractServiceSampler {
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

    async getWaitForPromise() {
        // Non-cached responses appear to have <script> elements inserted
        // which makes XHR calls back to the server to get HTML chunks.
        // Look for this script, and if it is present, wait for the final
        // XHR call.
        const UPDATER_SCRIPT_SELECTOR = 'div.umlaut-resolve-container script';

        // We wait for the `load` event, by which time all <script> tags should
        // have loaded.  This probably isn't foolproof, because it's always possible
        // for new <script> tags to be injected by long-running JavaScript code,
        // but this seems to work fine for GetIt/Umlaut.
        await this.page.waitForLoadState( 'load' );

        // We have to return different promises for cached and non-cached responses.
        try {
            // By this time, the <script> tag that is potentially the update script
            // should have already been loaded.  It's either there or it's not.
            // Give Playwright only 1/10 of a second to find it.
            // If this `.waitForSelector` times out, presumably this is a cached response,
            // and so we throw the error so the `catch` block can return the appropriate
            // promise for a cached page.
            // If we did not have this step, and instead started with the `page.locator`
            // step that comes next, we'd have to wait for the default timeout before
            // treating this as a cached response, which ironically would make
            // sampling of cached pages significantly slower than non-cached pages.
            await this.page.waitForSelector( UPDATER_SCRIPT_SELECTOR, {
                state: 'attached',
                timeout: 100,
            } );

            // This is potentially a non-cached page.  We confirm that the <script>
            // tag is the updater script.
            const updaterScript = await this.page.locator( UPDATER_SCRIPT_SELECTOR );
            const script = await updaterScript.textContent();

            // Sample: note that we can't match against this exact string because
            // the umlaut.request_id value changes.
            /*
                //<![CDATA[
                jQuery(document).ready(function ($) {
                  var umlaut_base, context_object, updater;
                  umlaut_base = "https://dev.getit.library.nyu.edu/";
                  context_object = "umlaut.request_id=54052&umlaut.institution=NYU";
                  updater = new Umlaut.HtmlUpdater(umlaut_base, context_object);
                    updater.add_section_target({ umlaut_section_id: "cover_image" });
                    updater.add_section_target({ umlaut_section_id: "search_inside" });
                    updater.add_section_target({ umlaut_section_id: "fulltext" });
                    updater.add_section_target({ umlaut_section_id: "export_citation" });
                    updater.add_section_target({ umlaut_section_id: "related_items" });
                    updater.add_section_target({ umlaut_section_id: "highlighted_link" });
                    updater.add_section_target({ umlaut_section_id: "service_errors" });
                  setTimeout(function () { updater.update(); }, 250.0);
                });
                //]]>
            */

            if ( script.match( /Umlaut.HtmlUpdater/ ) ) {
                // This is definitely a non-cached page.
                return this.page.waitForEvent( 'response', async response => {
                    if ( response.status() === 200 && response.url().startsWith( 'https://dev.getit.library.nyu.edu/resolve/partial_html_sections' ) ) {
                        const responseJson = await response.json();

                        return responseJson.partial_html_sections.complete === 'true';
                    }
                } );
            } else {
                // Hopefully we never get here, but presumably if we did, the response
                // is complete, and we can return a promise that basically has
                // already been fulfilled, since we started by waiting for the
                // `load` event.
                return this.page.waitForLoadState( 'load' );
            }
        } catch ( error ) {
            // Assume that this response is cached, and that there will be no
            // XHR calls, and that the HTML contains the complete list of links.
            // This promise is basically already fulfilled, since we started by waiting
            // for the `load` event.
            return this.page.waitForLoadState( 'load' );
        }
    }
}
