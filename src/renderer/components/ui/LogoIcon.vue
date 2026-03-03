<script setup lang="ts">
defineProps<{
  size?: number;
}>();
</script>

<template>
  <svg
    :width="size || 38"
    :height="size || 38"
    viewBox="0 0 38 38"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="logo-icon"
  >
    <g filter="url(#logo_shadow)">
      <rect x="4" y="4" width="30" height="30" rx="10" fill="var(--background-color-1, white)" />
      <rect x="8" y="11" width="5" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect x="24" y="11" width="6" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect x="8" y="17" width="4" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect x="8" y="20" width="4" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect x="26" y="17" width="4" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect x="8" y="14" width="4" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect x="25" y="14" width="5" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect x="8" y="23" width="4" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect x="26" y="23" width="4" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect x="26" y="20" width="4" height="1" rx="0.5" fill="currentColor" fill-opacity="0.22" />
      <rect
        width="5"
        height="1"
        rx="0.5"
        transform="matrix(1 0 0 -1 8 27)"
        fill="currentColor"
        fill-opacity="0.22"
      />
      <rect
        width="5"
        height="1"
        rx="0.5"
        transform="matrix(1 0 0 -1 25 27)"
        fill="currentColor"
        fill-opacity="0.22"
      />
      <path
        d="M21.5 13.5V14.6492C21.5 14.8763 21.5773 15.0966 21.7191 15.2739L23.2809 17.2261C23.4227 17.4034 23.5 17.6237 23.5 17.8508V24.5C23.5 25.0523 23.0523 25.5 22.5 25.5H15.5C14.9477 25.5 14.5 25.0523 14.5 24.5V17.8508C14.5 17.6237 14.5773 17.4034 14.7191 17.2261L16.2809 15.2739C16.4227 15.0966 16.5 14.8763 16.5 14.6492V13.5C16.5 12.9477 16.9477 12.5 17.5 12.5H20.5C21.0523 12.5 21.5 12.9477 21.5 13.5Z"
        stroke="currentColor"
      />
      <path
        d="M23 23.4834C23 24.2376 23 24.1423 23 24.5711C23 25 23 24.857 23 25C21.8842 25 17.0138 25 14.2928 25C14.2928 24.5711 14.2929 24.0373 14.2929 23.4834C13.0908 23.4834 16.0959 23.4834 14.2929 23.4834C15.4949 23.4834 16.0857 22.3957 18.7928 23.4834C21.5 24.5711 23 23.4834 23 23.4834Z"
        fill="currentColor"
      />
      <path d="M16.5 14.5H21.5" stroke="currentColor" />
      <path
        d="M20.5373 21.9992C20.476 22.0031 20.4146 21.9931 20.3572 21.9701C20.2998 21.947 20.2477 21.9114 20.2043 21.8655C20.1609 21.8195 20.1272 21.7644 20.1055 21.7037C20.0838 21.643 20.0745 21.5782 20.0783 21.5134V20.0107L19.3898 20.9321C19.3449 20.9889 19.2888 21.0347 19.2253 21.066C19.1619 21.0974 19.0927 21.1137 19.0226 21.1137C18.9526 21.1137 18.8834 21.0974 18.8199 21.066C18.7565 21.0347 18.7003 20.9889 18.6555 20.9321L17.9188 19.9139V21.4659C17.9224 21.5305 17.9131 21.5953 17.8913 21.6559C17.8695 21.7165 17.8358 21.7715 17.7925 21.8173C17.7491 21.8632 17.697 21.8987 17.6397 21.9217C17.5823 21.9447 17.521 21.9546 17.4598 21.9508C17.3985 21.9546 17.3372 21.9447 17.2799 21.9217C17.2225 21.8987 17.1705 21.8632 17.1271 21.8173C17.0837 21.7715 17.05 21.7165 17.0283 21.6559C17.0065 21.5953 16.9971 21.5305 17.0008 21.4659V18.4591C17.0032 18.3596 17.0357 18.2636 17.0936 18.185C17.1515 18.1065 17.2316 18.0496 17.3223 18.0226C17.4109 17.994 17.5053 17.9925 17.5947 18.0183C17.684 18.0441 17.7646 18.0961 17.8271 18.1683L19.0224 19.8171L20.1699 18.2651C20.2277 18.1862 20.3082 18.1293 20.3993 18.103C20.4903 18.0767 20.587 18.0825 20.6747 18.1194C20.7654 18.1464 20.8456 18.2033 20.9034 18.2818C20.9613 18.3604 20.9938 18.4564 20.9963 18.5559V21.4659C21.0046 21.5339 20.9989 21.603 20.9794 21.6684C20.96 21.7338 20.9273 21.794 20.8836 21.8448C20.8399 21.8955 20.7863 21.9356 20.7265 21.9623C20.6667 21.9889 20.6022 22.0015 20.5373 21.9992Z"
        fill="currentColor"
      />
    </g>
    <defs>
      <filter
        id="logo_shadow"
        x="0"
        y="0"
        width="38"
        height="38"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feFlood flood-opacity="0" result="BackgroundImageFix" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feOffset />
        <feGaussianBlur stdDeviation="2" />
        <feComposite in2="hardAlpha" operator="out" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
        <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
        <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
      </filter>
    </defs>
  </svg>
</template>

<style scoped>
.logo-icon {
  color: var(--primary-color);
}
</style>
