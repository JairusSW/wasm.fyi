<script lang="ts">
 import {configIdentity} from '$lib/data/runtimes';
 import {ui} from '$lib/state.svelte';
 import {versionIdentity} from '$lib/version-identity';
 import type {CfgId} from '$lib/data/types';
 import type {Source} from '$lib/api/benchmark-types';
 let {id,version,source}: {id:CfgId;version?:string;source?:Source}=$props();
 const identity=$derived(version!=null?versionIdentity(version,source):configIdentity(ui.machine,id));
</script>
{#if identity.url}<a class="version mono" href={identity.url} target="_blank" rel="noopener noreferrer" title={identity.label} aria-label={`Open ${identity.label} source`}>{identity.label}</a>{:else}<span class="version mono" title={identity.label}>{identity.label}</span>{/if}
<style>/* Long toolchain strings are cut short; the full version is in the title. */
.version{font-size:11px;color:var(--fg3);white-space:nowrap;display:inline-block;max-width:14ch;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}a{text-decoration:underline;text-decoration-color:var(--line2);text-underline-offset:3px}a:hover{color:var(--fg)}</style>
