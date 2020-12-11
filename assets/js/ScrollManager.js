window.addEventListener("scroll", (event) => {
    scroll = this.scrollY;
    updateNavbar(scroll);
});
var bigLogo = true;
function updateNavbar(scroll) {
    if (scroll > 300) {
        if (bigLogo) {
            $('#navbar').addClass('short');
            $('#nav-logo-full').toggle('slide');
            $('#nav-logo').toggle('slide');
            bigLogo = false;
        }
    } else {
        if (!bigLogo) {
            $('#navbar').removeClass('short');
            $('#nav-logo').toggle('slide');
            $('#nav-logo-full').toggle('slide');
            bigLogo = true;
        }
    }
}
